import sharp from "sharp";

function toDataUrlPng(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export async function splitFourPanelToDataUrls(input: {
  fourPanelImageUrl: string;
}): Promise<[string, string, string, string]> {
  const res = await fetch(input.fourPanelImageUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to download 4-panel image: ${res.status} ${await res.text()}`,
    );
  }
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const img = sharp(buf);
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("Missing image dimensions");

  // Assume a simple 2x2 grid.
  const w = meta.width;
  const h = meta.height;
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);

  const f1 = await img
    .clone()
    .extract({ left: 0, top: 0, width: halfW, height: halfH })
    .png()
    .toBuffer();
  const f2 = await img
    .clone()
    .extract({ left: halfW, top: 0, width: w - halfW, height: halfH })
    .png()
    .toBuffer();
  const f3 = await img
    .clone()
    .extract({ left: 0, top: halfH, width: halfW, height: h - halfH })
    .png()
    .toBuffer();
  const f4 = await img
    .clone()
    .extract({ left: halfW, top: halfH, width: w - halfW, height: h - halfH })
    .png()
    .toBuffer();

  return [toDataUrlPng(f1), toDataUrlPng(f2), toDataUrlPng(f3), toDataUrlPng(f4)];
}

