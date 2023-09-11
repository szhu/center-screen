#!/usr/bin/env deno run --allow-run

import { OutputMode, exec } from "https://deno.land/x/exec@0.0.5/mod.ts";

const out = await exec("displayplacer list", { output: OutputMode.Capture });

interface Display {
  id: string;
  resolution: [number, number];
  origin: [number, number];
  rotation: number;
  raw: {
    "Persistent screen id": string;
    "Contextual screen id": string;
    "Serial screen id": string;
    Type: string;
    Resolution: string;
    Hertz: string;
    "Color Depth": string;
    Scaling: string;
    Origin: string;
    Rotation: string;
    Enabled: string;
  };
}

const lines = out.output.split("\n");

const displays: Display[] = [];
let currentDisplay = undefined as
  | (Omit<Partial<Display>, "raw"> & { raw: Partial<Display["raw"]> })
  | undefined;
{
  const startParseDisplay = () => {
    currentDisplay = { raw: {} };
  };
  const endParseDisplay = () => {
    if (currentDisplay) {
      displays.push(currentDisplay as Display);
    }
    currentDisplay = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("Persistent screen id:")) {
      startParseDisplay();
    }
    if (!line.trim()) {
      endParseDisplay();
      continue;
    }
    if (line.startsWith("Execute the command below")) {
      // End of all displays
      break;
    }

    if (line.startsWith("Resolutions for")) {
      endParseDisplay();
      continue;
    }

    if (!currentDisplay) {
      continue;
    }
    const [, rawKey, value] = line.split(/^([^:]*):(.*)$/);
    if (rawKey) {
      const key = rawKey.trim() as keyof Display["raw"];
      if (key === "Resolution") {
        const [xSize, ySize] = value.split("x");
        currentDisplay.resolution = [+xSize, +ySize];
      } else if (key === "Origin") {
        const [, minX, minY] = value.match(/\(([-0-9]+),([-0-9]+)\)/) || [];
        currentDisplay.origin = [+minX, +minY];
      } else if (key === "Rotation") {
        currentDisplay.rotation = parseFloat(value);
      }
      currentDisplay.raw[key] = value.trim();
    } else {
      endParseDisplay();
    }
  }
  endParseDisplay();
}
console.log(displays);

class DimWithPosition {
  constructor(public min: number, public size: number) {}

  get max() {
    return this.min + this.size;
  }

  set max(newMax) {
    this.min += newMax - this.max;
  }

  get mid() {
    return this.min + this.size / 2;
  }

  set mid(newMid) {
    this.min += newMid - this.mid;
  }
}

class RectWithPosition {
  x: DimWithPosition;
  y: DimWithPosition;
  constructor(minX: number, minY: number, xSize: number, ySize: number) {
    this.x = new DimWithPosition(minX, xSize);
    this.y = new DimWithPosition(minY, ySize);
  }

  clone() {
    return new RectWithPosition(
      this.x.min,
      this.y.min,
      this.x.size,
      this.y.size
    );
  }
}

function displayToRectangle(display: Display) {
  const [xSize, ySize] = display.resolution;
  const [minX, minY] = display.origin;
  return new RectWithPosition(minX, minY, xSize, ySize);
}

enum DimSideOverlap {
  Inside = "4.Inside",
  Aligned = "3.Aligned",
  StickingOut = "2.StickingOut",
  Adjacent = "1.Adjacent",
  Cleared = "0.Cleared",
}

interface DimRelation {
  min: DimSideOverlap;
  max: DimSideOverlap;
}

function getDimRelation(
  base: DimWithPosition,
  curr: DimWithPosition
): DimRelation {
  let min: DimSideOverlap;
  if (curr.min > base.min) {
    min = DimSideOverlap.Inside;
  } else if (curr.min === base.min) {
    min = DimSideOverlap.Aligned;
  } else if (curr.max > base.min) {
    min = DimSideOverlap.StickingOut;
  } else if (curr.max === base.min) {
    min = DimSideOverlap.Adjacent;
  } else {
    min = DimSideOverlap.Cleared;
  }

  let max: DimSideOverlap;
  if (curr.max < base.max) {
    max = DimSideOverlap.Inside;
  } else if (curr.max === base.max) {
    max = DimSideOverlap.Aligned;
  } else if (curr.min < base.max) {
    max = DimSideOverlap.StickingOut;
  } else if (curr.min === base.max) {
    max = DimSideOverlap.Adjacent;
  } else {
    max = DimSideOverlap.Cleared;
  }

  return {
    min,
    max,
  };
}

function getDimClosestAlignment(base: DimWithPosition, curr: DimWithPosition) {
  const rel = getDimRelation(base, curr);
  if (rel.min <= DimSideOverlap.Adjacent) {
    return "before";
  }

  if (rel.max <= DimSideOverlap.Adjacent) {
    return "after";
  }

  if (
    (rel.min >= DimSideOverlap.Inside && rel.max >= DimSideOverlap.Inside) ||
    (rel.min <= DimSideOverlap.StickingOut &&
      rel.max <= DimSideOverlap.StickingOut)
  ) {
    return "center";
  }

  return curr.mid < base.mid ? "min" : "max";
}

function getRectRelation(base: RectWithPosition, curr: RectWithPosition) {
  return {
    x: getDimRelation(base.x, curr.x),
    y: getDimRelation(base.y, curr.y),
  };
}

function getRectClosestAlignment(
  base: RectWithPosition,
  curr: RectWithPosition
) {
  return {
    x: getDimClosestAlignment(base.x, curr.x),
    y: getDimClosestAlignment(base.y, curr.y),
  } as const;
}

// function

// const rects = displays.map(displayToRectangle);
// console.log(rects);
// console.log(getRectRelation(rects[0], rects[1]));
// rects[1].x.mid = rects[0].x.mid;
// // rs[1].y.max += 1;
// console.log(rects);
// console.log(getRectRelation(rects[0], rects[1]));

const rects = displays.map(displayToRectangle);
const rel = getRectRelation(rects[0], rects[1]);
const align = getRectClosestAlignment(rects[0], rects[1]);
console.log(rel);
console.log(align);

function alignRect(
  curr: RectWithPosition,
  base: RectWithPosition,
  align: ReturnType<typeof getRectClosestAlignment>
) {
  if (align.x === "min") {
    curr.x.min = base.x.min;
  } else if (align.x === "max") {
    curr.x.max = base.x.max;
  } else if (align.x === "center") {
    curr.x.mid = base.x.mid;
  } else if (align.x === "before") {
    curr.x.max = base.x.min;
  } else if (align.x === "after") {
    curr.x.min = base.x.max;
  }

  if (align.y === "min") {
    curr.y.min = base.y.min;
  } else if (align.y === "max") {
    curr.y.max = base.y.max;
  } else if (align.y === "center") {
    curr.y.mid = base.y.mid;
  } else if (align.y === "before") {
    curr.y.max = base.y.min;
  } else if (align.y === "after") {
    curr.y.min = base.y.max;
  }
}
// alignRect(rects[1], rects[0], align);
alignRect(rects[1], rects[0], {
  x: "center",
  y: "after",
});

// // Get dimensions that are [inside, inside]:
// const insideInsideX =
//   rel.x.min >= DimSideOverlap.Inside && rel.x.max >= DimSideOverlap.Inside;
// const insideInsideY =
//   rel.y.min >= DimSideOverlap.Inside && rel.y.max >= DimSideOverlap.Inside;

const cmd = [
  "displayplacer",
  [
    //
    `id:${displays[1].raw["Persistent screen id"]}`,
    `res:${displays[1].raw["Resolution"]}`,
    // `hz:${displays[1].raw["Hertz"]}`,
    // `color_depth:${displays[1].raw["Color Depth"]}`,
    // `scaling:${displays[1].raw["Scaling"]}`,
    `origin:(${rects[1].x.min},${rects[1].y.min})`,
    // `degree:${displays[1].rotation}`,
  ].join(" "),
];

console.log(cmd.map((arg) => JSON.stringify(arg)).join(" "));
await exec(cmd.map((arg) => JSON.stringify(arg)).join(" "));
