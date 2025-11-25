import React from "react";
import "@/styles/loading.css";

const Loader = () => {
  return (
    <div className="flex h-full w-full flex-1 p-2 pl-0">
      <div className="flex h-full w-full flex-1 items-center justify-center rounded-lg bg-secondary">
        {/* Content Area with Database Fetching Animation */}
        <div className="mx-auto max-w-lg">
          {/* Modern Loading Animation */}
          <div className="flex flex-col items-center justify-center">
            <div className="preloader-wrap">
              <div className="preloader">
                <i className="layer"></i>
                <i className="layer"></i>
                <i className="layer"></i>
              </div>
              <span>Loading</span>
            </div>

            {/* Modern Progress Bar */}
            <div className="w-80">
              <div className="h-2 overflow-hidden rounded-full bg-background/10">
                <div className="relative h-full rounded-full bg-gradient-to-r from-primary/30 via-primary to-primary/30">
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                    style={{
                      animation: "shimmer 1.5s infinite",
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Loader;
