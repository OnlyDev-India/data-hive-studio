"use server";

import { SettingsType, defaultSettings } from "@/types/settings.type";
import { promises as fs } from "fs";

async function readSettings(settingsPath: string): Promise<SettingsType> {
  try {
    const data = await fs.readFile(settingsPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or can't be read, return default settings
    return defaultSettings;
  }
}

async function writeSettings(settingsPath: string, settings: SettingsType): Promise<void> {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

export const getSettings = async (settingsPath: string) => {
  try {
    const settings = await readSettings(settingsPath);
    return { success: true, data: settings };
  } catch (error: any) {
    return { success: false, error: error.message, data: defaultSettings };
  }
};

export const updateSettings = async (settingsPath: string, settings: SettingsType) => {
  try {
    await writeSettings(settingsPath, settings);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

