/** Shown while `bootstrap.ts` preloads saved connections/workspace state and
 *  (desktop only) finishes opening any file the OS handed us at launch —
 *  see `runStartupBootstrap`. Fully replaces the screen rather than
 *  overlaying it (unlike `WebGate`'s connecting modal), since this covers
 *  the app's very first paint.
 *
 *  Background/text use the app's own theme tokens (`bg-background`/
 *  `text-muted-foreground`, index.css) rather than a fixed color, so the
 *  splash blends straight into whichever theme (light/dark) the user
 *  already has — index.html's pre-paint script sets that before React ever
 *  mounts, so it's correct on this very first render. Only the loader's
 *  accent color is fixed, sampled straight from the app icon
 *  (`src-tauri/icons/*.png`): #4477e3. */
export function SplashScreen({ status }: { status?: string }) {
  return (
    <div className="dh-splash bg-background text-muted-foreground flex h-full w-full flex-col items-center justify-center select-none">
      <style>{`
        .dh-splash {
          font-size: 14px;
        }
        .dh-splash-preloader {
          height: 100px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
        }
        .dh-splash-layer {
          display: block;
          position: absolute;
          height: 50px;
          width: 50px;
          border-radius: 50%;
          box-shadow: 1px 1px #4477e3, 1px 2px rgba(0, 0, 0, 0.35);
          transform: rotateX(50deg) rotateY(0deg) rotateZ(45deg);
        }
        .dh-splash-layer:nth-of-type(1) {
          background: rgba(68, 119, 227, 0.65);
          margin-top: 36px;
          animation: dh-splash-movedown 0.8s cubic-bezier(0.39, 0.575, 0.565, 1) 0.4s infinite normal;
        }
        .dh-splash-layer:nth-of-type(2) {
          background: rgba(122, 160, 235, 0.65);
          margin-top: 18px;
        }
        .dh-splash-layer:nth-of-type(3) {
          background: rgba(197, 214, 247, 0.8);
          animation: dh-splash-moveup 0.8s cubic-bezier(0.39, 0.575, 0.565, 1) infinite normal;
        }
        @keyframes dh-splash-moveup {
          0%, 60%, 100% { transform: rotateX(50deg) rotateY(0deg) rotateZ(45deg) translateZ(0); }
          25% { transform: rotateX(50deg) rotateY(0deg) rotateZ(45deg) translateZ(5px); }
        }
        @keyframes dh-splash-movedown {
          0%, 60%, 100% { transform: rotateX(50deg) rotateY(0deg) rotateZ(45deg) translateZ(0); }
          25% { transform: rotateX(50deg) rotateY(0deg) rotateZ(45deg) translateZ(-5px); }
        }
      `}</style>
      <div className="dh-splash-preloader">
        <i className="dh-splash-layer" />
        <i className="dh-splash-layer" />
        <i className="dh-splash-layer" />
      </div>
      <span>{status ?? "Loading"}</span>
    </div>
  );
}
