import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> },
) {
  const { file } = await ctx.params;

  // Join the file path segments
  const filePathSegments = Array.isArray(file) ? file : [file];
  const relativePath = filePathSegments.join("/");

  // Security: prevent directory traversal but allow subdirectories like vid/Clip1.mp4
  const normalizedFile = normalize(relativePath).replace(/\\/g, "/");
  if (normalizedFile.includes("..") || normalizedFile.startsWith("/")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  try {
    const dataDir = join(process.cwd(), "data");
    const filePath = normalize(join(dataDir, normalizedFile));

    // Ensure the file is within the data directory
    if (!filePath.startsWith(normalize(dataDir))) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    const fileBuffer = await readFile(filePath);

    // Determine content type based on file extension
    let contentType = "application/octet-stream";
    const lowerPath = normalizedFile.toLowerCase();
    if (lowerPath.endsWith(".mp4")) {
      contentType = "video/mp4";
    } else if (lowerPath.endsWith(".png")) {
      contentType = "image/png";
    } else if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (lowerPath.endsWith(".gif")) {
      contentType = "image/gif";
    }

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
