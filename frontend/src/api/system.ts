import api from "./client";

export interface TimezoneResponse {
  timezone: string | null;
}

export interface SystemHealth {
  status: "ok";
  db: "ok";
}

export interface BackupInfo {
  filename: string;
  size_bytes: number;
  created_at: string;
}

export interface BackupResult {
  message: string;
  path: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  next_run_time: string | null;
}

export async function setSystemTimezone(timezone: string): Promise<TimezoneResponse> {
  return (await api.put<TimezoneResponse>("/system/timezone", { timezone })).data;
}

export async function getSystemTimezone(): Promise<TimezoneResponse> {
  return (await api.get<TimezoneResponse>("/system/timezone")).data;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return (await api.get<SystemHealth>("/system/health")).data;
}

export async function getBackups(): Promise<BackupInfo[]> {
  return (await api.get<BackupInfo[]>("/system/backups")).data;
}

export async function createBackup(): Promise<BackupResult> {
  return (await api.post<BackupResult>("/system/backup")).data;
}

export async function getScheduledJobs(): Promise<ScheduledJob[]> {
  return (await api.get<ScheduledJob[]>("/system/jobs")).data;
}
