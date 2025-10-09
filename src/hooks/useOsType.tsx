import React, { useEffect, useState } from "react";

const useOsType = () => {
  const [osType, setOsType] = useState<string>("");
  const getOperatingSystem = () => {
    if (typeof window === "undefined") return "unknown";
    const platform = navigator.platform.toLowerCase();
    if (platform.includes("win")) return "win32";
    if (platform.includes("mac")) return "darwin";
    if (platform.includes("linux")) return "linux";
    return "unknown";
  };

  useEffect(() => {
    setOsType(getOperatingSystem());
  }, []);

  return { osType };
};

export default useOsType;
