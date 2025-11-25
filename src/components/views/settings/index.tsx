"use client";

import SettingsForm from "@/components/settings/settings-form";

const SettingsView = () => {
  return (
    <div className="h-[calc(100%-var(--tabs-height))] w-full overflow-auto custom-scrollbar">
      <SettingsForm />
    </div>
  );
};

export default SettingsView;

