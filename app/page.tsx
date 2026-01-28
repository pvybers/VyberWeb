import { redirect } from "next/navigation";
import { readFile } from "node:fs/promises";
import {
  createWorld,
  createWorldState,
  listWorlds,
  setActionsForWorldState,
} from "@/lib/worldRepo";

export const dynamic = "force-dynamic";

function extractInitialSceneSummary(fullPrompt: string): string {
  // Use the text around Clip 01 and Clip 02 as the initial scene summary.
  const clip1Idx = fullPrompt.indexOf("### Clip 01");
  if (clip1Idx === -1) return "The story begins at night outside a SoMa corporate tower.";
  const clip2Idx = fullPrompt.indexOf("### Clip 02", clip1Idx + 1);
  const endIdx =
    clip2Idx === -1 ? Math.min(fullPrompt.length, clip1Idx + 800) : Math.min(clip2Idx + 800, fullPrompt.length);
  return fullPrompt.slice(clip1Idx, endIdx).trim();
}

export default async function Home() {
  const worlds = await listWorlds();
  if (worlds[0]) {
    redirect(`/worlds/${worlds[0].id}`);
  }

  const worldPrompt = await readFile(`${process.cwd()}/worldPrompt.txt`, "utf8");

  const world = await createWorld({
    id: "default",
    worldPrompt: worldPrompt.trim(),
  });

  // Use local clips from /data/vid served by the app.
  // Clip1: frame1 -> frame2
  // Clip2: frame2 -> frame3
  // Clip3: frame3 -> frame4
  const clip1 = "/data/vid/Clip1.mp4";
  const clip2 = "/data/vid/Clip2.mp4";
  const clip3 = "/data/vid/Clip3.mp4";
  
  // Use all 3 clips for seamless looping
  const videoUrls = [clip1, clip2, clip3];
  
  // lastFrameUrl should be the end frame of the last clip
  // Clip3 ends at frame4, so use frame4.png
  const lastFrameUrl = "/data/frame/frame4.png";
  
  const state = await createWorldState({
    worldId: world.id,
    // Exactly 3 clips
    videoUrls,
    lastFrameUrl,
    sceneSummary: extractInitialSceneSummary(worldPrompt),
  });

  await setActionsForWorldState({
    worldStateId: state.id,
    actions: [
      { label: "Move forward", prompt: "Move forward cautiously and scan the area." },
      { label: "Look around", prompt: "Turn your head and carefully observe the surroundings." },
      { label: "Interact", prompt: "Interact with the most interesting object in view." },
    ],
  });

  redirect(`/worlds/${world.id}`);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
        <p className="text-sm text-zinc-300">Booting your world…</p>
        </div>
    </div>
  );
}
