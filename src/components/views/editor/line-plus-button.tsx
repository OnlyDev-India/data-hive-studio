"use client";
import React from "react";


const LinePlusButton: React.FC = () => {
  return (
    <button
      className="line-plus-button flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[32%] border border-primary bg-primary text-sm font-bold text-white opacity-0 shadow-sm transition-all duration-200 ease-in-out group-hover:opacity-100"
      style={{
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
      }}
    >
      +
    </button>
  );
};

export default LinePlusButton;
