"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsType, defaultSettings } from "@/types/settings.type";

export const useSettings = () => {
  const [settings, setSettings] = useState<SettingsType>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (typeof window.electron !== "undefined") {
          // Electron app - use IPC
          const result = await window.electron.readSettings();
          if (result.success) {
            setSettings(result.data);
          } else {
            setSettings(defaultSettings);
          }
        } else {
          // Web app - use localStorage
          const storedSettings = localStorage.getItem("settings");
          if (storedSettings) {
            try {
              const parsed = JSON.parse(storedSettings) as SettingsType;
              setSettings(parsed);
            } catch {
              setSettings(defaultSettings);
            }
          } else {
            setSettings(defaultSettings);
          }
        }
      } catch (err: any) {
        setError(err.message);
        setSettings(defaultSettings);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const updateSettings = useCallback(
    async (newSettings: SettingsType) => {
      try {
        if (typeof window.electron !== "undefined") {
          // Electron app - use IPC
          const result = await window.electron.writeSettings(newSettings);
          if (result.success) {
            setSettings(newSettings);
            return { success: true };
          } else {
            return { success: false, error: result.error };
          }
        } else {
          // Web app - use localStorage
          localStorage.setItem("settings", JSON.stringify(newSettings));
          setSettings(newSettings);
          return { success: true };
        }
      } catch (err: any) {
        setError(err.message);
        return { success: false, error: err.message };
      }
    },
    [],
  );

  return {
    settings,
    loading,
    error,
    updateSettings,
  };
};

