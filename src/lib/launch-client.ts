import { getSupabase } from './supabase/client';
import type { LaunchWorkspace, LaunchTask, LaunchTaskPatch, LaunchExperiment, LaunchExperimentInput, LaunchHistoryEvent } from './launch-workspace';

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args).abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return data as T;
}
export const getLaunchWorkspace = () => rpc<LaunchWorkspace>('owner_launch_workspace');
export const updateLaunchTask = (task: Pick<LaunchTask, 'id' | 'version'>, patch: LaunchTaskPatch) => rpc<LaunchTask>('owner_launch_task_update', {
  target_id: task.id, expected_version: task.version, next_status: patch.status,
  evidence_text: patch.evidence.trim(), assignee: patch.assigned_to.trim(), due_date: patch.due_on || null,
});
// Generate id once when opening a new experiment form, and retain it across
// retries. Version 0 means create; existing records require their current version.
export const saveLaunchExperiment = (id: string, expectedVersion: number, input: LaunchExperimentInput) => rpc<LaunchExperiment>('owner_launch_experiment_save', {
  target_id: id, expected_version: expectedVersion, experiment: input,
});
export const getLaunchHistory = (kind: 'task' | 'experiment', id: string) => rpc<LaunchHistoryEvent[]>('owner_launch_history', { target_kind: kind, target_id: id });
