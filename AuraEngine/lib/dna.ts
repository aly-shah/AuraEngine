import { supabase } from './supabase';
import { getGeminiClient } from './geminiClient';
import { AI_MODELS } from './aiConfig';

// ── Types ────────────────────────────────────────────────────

export type DnaCategory =
  | 'sales_outreach' | 'analytics' | 'email' | 'content' | 'lead_research'
  | 'blog' | 'social' | 'automation' | 'strategy' | 'support' | 'general';

export type DnaModule = 'email' | 'voice' | 'blog' | 'social' | 'support' | 'general';

export interface DnaVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default_value: string;
  description: string;
}

export interface ToneConfig {
  formality: number;   // 1-10
  creativity: number;  // 1-10
  verbosity: number;   // 1-10
  custom_instructions: string;
}

export type OutputSchema = Record<string, string>;

export interface DnaRecord {
  id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  category: DnaCategory;
  description: string;
  module: DnaModule;
  system_prompt: string;
  prompt_template: string;
  variables: DnaVariable[];
  tone_config: ToneConfig;
  output_schema: OutputSchema | null;
  guardrails: string[];
  is_locked: boolean;
  is_active: boolean;
  active_version: number;
  ab_group: string | null;
  marketplace_status: string | null;
  fine_tune_model_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DnaVersion {
  id: string;
  dna_id: string;
  version_number: number;
  system_prompt: string;
  prompt_template: string;
  variables: DnaVariable[];
  tone_config: ToneConfig;
  output_schema: OutputSchema | null;
  guardrails: string[];
  change_note: string;
  created_by: string;
  created_at: string;
}

export interface DnaUsageLog {
  id: string;
  dna_id: string;
  version_number: number;
  workspace_id: string | null;
  user_id: string | null;
  module: string;
  context: Record<string, unknown>;
  variables_used: Record<string, unknown>;
  tokens_used: number;
  latency_ms: number;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

export interface DnaTestResult {
  systemInstruction: string;
  finalPrompt: string;
  response: string;
  tokensUsed: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export const DNA_CATEGORIES: { value: DnaCategory; label: string }[] = [
  { value: 'sales_outreach', label: 'Sales Outreach' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'email', label: 'Email' },
  { value: 'content', label: 'Content' },
  { value: 'lead_research', label: 'Lead Research' },
  { value: 'blog', label: 'Blog' },
  { value: 'social', label: 'Social' },
  { value: 'automation', label: 'Automation' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'support', label: 'Support' },
  { value: 'general', label: 'General' },
];

export const DNA_MODULES: { value: DnaModule; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'voice', label: 'Voice' },
  { value: 'blog', label: 'Blog' },
  { value: 'social', label: 'Social' },
  { value: 'support', label: 'Support' },
  { value: 'general', label: 'General' },
];

const DEFAULT_TONE: ToneConfig = {
  formality: 5,
  creativity: 5,
  verbosity: 5,
  custom_instructions: '',
};

// ── Slug helper ──────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ── CRUD ─────────────────────────────────────────────────────

export interface ListDnaOpts {
  category?: DnaCategory;
  module?: DnaModule;
  search?: string;
  workspaceId?: string | null;
}

export async function listDna(opts?: ListDnaOpts): Promise<DnaRecord[]> {
  let query = supabase
    .from('prompt_dna_registry')
    .select('*')
    .order('updated_at', { ascending: false });

  if (opts?.category) query = query.eq('category', opts.category);
  if (opts?.module) query = query.eq('module', opts.module);
  if (opts?.search) query = query.or(`name.ilike.%${opts.search}%,slug.ilike.%${opts.search}%,description.ilike.%${opts.search}%`);
  if (opts?.workspaceId !== undefined) {
    if (opts.workspaceId === null) query = query.is('workspace_id', null);
    else query = query.eq('workspace_id', opts.workspaceId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DnaRecord[];
}

export async function getDna(id: string): Promise<DnaRecord | null> {
  const { data, error } = await supabase
    .from('prompt_dna_registry')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as DnaRecord | null;
}

export async function createDna(
  record: Omit<DnaRecord, 'id' | 'created_at' | 'updated_at' | 'active_version' | 'ab_group' | 'marketplace_status' | 'fine_tune_model_id'>,
): Promise<DnaRecord> {
  const { data, error } = await supabase
    .from('prompt_dna_registry')
    .insert({
      workspace_id: record.workspace_id,
      name: record.name,
      slug: record.slug,
      category: record.category,
      description: record.description,
      module: record.module,
      system_prompt: record.system_prompt,
      prompt_template: record.prompt_template,
      variables: record.variables,
      tone_config: record.tone_config,
      output_schema: record.output_schema,
      guardrails: record.guardrails,
      is_locked: record.is_locked,
      is_active: record.is_active,
      active_version: 1,
      created_by: record.created_by,
    })
    .select()
    .single();

  if (error) throw error;
  const dna = data as DnaRecord;

  // Create version 1 snapshot
  await supabase.from('prompt_dna_versions').insert({
    dna_id: dna.id,
    version_number: 1,
    system_prompt: dna.system_prompt,
    prompt_template: dna.prompt_template,
    variables: dna.variables,
    tone_config: dna.tone_config,
    output_schema: dna.output_schema,
    guardrails: dna.guardrails,
    change_note: 'Initial version',
    created_by: dna.created_by,
  });

  return dna;
}

export async function updateDna(
  id: string,
  updates: Partial<Pick<DnaRecord, 'name' | 'slug' | 'category' | 'description' | 'module' | 'system_prompt' | 'prompt_template' | 'variables' | 'tone_config' | 'output_schema' | 'guardrails' | 'is_locked' | 'is_active'>>,
  changeNote: string,
  userId: string,
): Promise<DnaRecord> {
  // Get current record to determine next version
  const current = await getDna(id);
  if (!current) throw new Error('DNA record not found');

  const nextVersion = current.active_version + 1;

  // Update registry
  const { data, error } = await supabase
    .from('prompt_dna_registry')
    .update({ ...updates, active_version: nextVersion })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  const dna = data as DnaRecord;

  // Create version snapshot
  await supabase.from('prompt_dna_versions').insert({
    dna_id: dna.id,
    version_number: nextVersion,
    system_prompt: dna.system_prompt,
    prompt_template: dna.prompt_template,
    variables: dna.variables,
    tone_config: dna.tone_config,
    output_schema: dna.output_schema,
    guardrails: dna.guardrails,
    change_note: changeNote,
    created_by: userId,
  });

  return dna;
}

export async function deleteDna(id: string): Promise<void> {
  const { error } = await supabase
    .from('prompt_dna_registry')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function duplicateDna(id: string, userId: string): Promise<DnaRecord> {
  const original = await getDna(id);
  if (!original) throw new Error('DNA record not found');

  return createDna({
    workspace_id: original.workspace_id,
    name: `${original.name} (Copy)`,
    slug: `${original.slug}_copy_${Date.now()}`,
    category: original.category,
    description: original.description,
    module: original.module,
    system_prompt: original.system_prompt,
    prompt_template: original.prompt_template,
    variables: original.variables,
    tone_config: original.tone_config,
    output_schema: original.output_schema,
    guardrails: original.guardrails,
    is_locked: false,
    is_active: false,
    created_by: userId,
  });
}

export async function toggleDnaActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('prompt_dna_registry')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}

// ── Versions ─────────────────────────────────────────────────

export async function getDnaVersions(dnaId: string): Promise<DnaVersion[]> {
  const { data, error } = await supabase
    .from('prompt_dna_versions')
    .select('*')
    .eq('dna_id', dnaId)
    .order('version_number', { ascending: false });

  if (error) throw error;
  return (data ?? []) as DnaVersion[];
}

export async function restoreVersion(dnaId: string, versionNumber: number, userId: string): Promise<DnaRecord> {
  const { data: versionData, error: versionError } = await supabase
    .from('prompt_dna_versions')
    .select('*')
    .eq('dna_id', dnaId)
    .eq('version_number', versionNumber)
    .single();

  if (versionError) throw versionError;
  const version = versionData as DnaVersion;

  return updateDna(
    dnaId,
    {
      system_prompt: version.system_prompt,
      prompt_template: version.prompt_template,
      variables: version.variables,
      tone_config: version.tone_config,
      output_schema: version.output_schema,
      guardrails: version.guardrails,
    },
    `Restored from v${versionNumber}`,
    userId,
  );
}

// ── AI Integration ───────────────────────────────────────────

export function buildToneInstruction(tone: ToneConfig): string {
  const parts: string[] = [];

  if (tone.formality <= 3) parts.push('Use a casual, conversational tone.');
  else if (tone.formality >= 8) parts.push('Use a highly formal, professional tone.');
  else parts.push('Use a balanced, professional yet approachable tone.');

  if (tone.creativity <= 3) parts.push('Be direct and factual — avoid metaphors or flourishes.');
  else if (tone.creativity >= 8) parts.push('Be creative — use vivid language, metaphors, and original phrasing.');
  else parts.push('Be moderately creative while staying clear and focused.');

  if (tone.verbosity <= 3) parts.push('Be extremely concise — every word must earn its place.');
  else if (tone.verbosity >= 8) parts.push('Be thorough and detailed — explain fully with examples.');
  else parts.push('Aim for moderate length — cover key points without over-explaining.');

  if (tone.custom_instructions) parts.push(tone.custom_instructions);

  return parts.join(' ');
}

export function buildGuardrailsBlock(guardrails: string[]): string {
  if (!guardrails.length) return '';
  return '\n\nGUARDRAILS:\n' + guardrails.map((g, i) => `${i + 1}. ${g}`).join('\n');
}

export function buildOutputSchemaBlock(schema: OutputSchema | null): string {
  if (!schema || Object.keys(schema).length === 0) return '';
  const fields = Object.entries(schema).map(([key, desc]) => `- ${key}: ${desc}`).join('\n');
  return `\n\nOUTPUT FORMAT:\nReturn a response with the following fields:\n${fields}`;
}

export function validateVariables(
  variableDefs: DnaVariable[],
  provided: Record<string, unknown>,
): { valid: boolean; missing: string[] } {
  const missing = variableDefs
    .filter(v => v.required && !(v.name in provided))
    .map(v => v.name);
  return { valid: missing.length === 0, missing };
}

export function buildPromptFromDnaRecord(
  dna: DnaRecord,
  variables: Record<string, unknown>,
  context?: string,
): { systemInstruction: string; finalPrompt: string } {
  // Fill defaults for missing variables
  const filled = { ...variables };
  for (const v of dna.variables) {
    if (!(v.name in filled) && v.default_value) {
      filled[v.name] = v.default_value;
    }
  }

  // Build system instruction
  const toneBlock = buildToneInstruction(dna.tone_config);
  const guardrailsBlock = buildGuardrailsBlock(dna.guardrails);
  const systemInstruction = `${dna.system_prompt}\n\nTONE: ${toneBlock}${guardrailsBlock}`;

  // Template substitution
  let finalPrompt = dna.prompt_template;
  for (const [key, value] of Object.entries(filled)) {
    finalPrompt = finalPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  // Append output schema
  const schemaBlock = buildOutputSchemaBlock(dna.output_schema);
  if (schemaBlock) finalPrompt += schemaBlock;

  // Append context
  if (context) finalPrompt += `\n\nADDITIONAL CONTEXT:\n${context}`;

  return { systemInstruction, finalPrompt };
}

export async function buildPromptFromDNA(
  dnaId: string,
  variables: Record<string, unknown>,
  context?: string,
): Promise<{ systemInstruction: string; finalPrompt: string }> {
  const dna = await getDna(dnaId);
  if (!dna) throw new Error('DNA record not found');

  const { valid, missing } = validateVariables(dna.variables, variables);
  if (!valid) throw new Error(`Missing required variables: ${missing.join(', ')}`);

  return buildPromptFromDnaRecord(dna, variables, context);
}

export async function testDnaPrompt(
  dna: DnaRecord,
  variables: Record<string, unknown>,
  context: string,
  userId: string,
): Promise<DnaTestResult> {
  const start = performance.now();

  try {
    const { systemInstruction, finalPrompt } = buildPromptFromDnaRecord(dna, variables, context);

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: AI_MODELS.text,
      contents: finalPrompt,
      config: {
        systemInstruction,
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
      },
    });

    const latencyMs = Math.round(performance.now() - start);
    const tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;
    const text = response.text ?? '';

    // Log usage (fire-and-forget)
    logDnaUsage({
      dna_id: dna.id,
      version_number: dna.active_version,
      workspace_id: dna.workspace_id,
      user_id: userId,
      module: dna.module,
      context: { test: true },
      variables_used: variables,
      tokens_used: tokensUsed,
      latency_ms: latencyMs,
      success: true,
      error_message: null,
    });

    return {
      systemInstruction,
      finalPrompt,
      response: text,
      tokensUsed,
      latencyMs,
      success: true,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : 'Unknown error';

    logDnaUsage({
      dna_id: dna.id,
      version_number: dna.active_version,
      workspace_id: dna.workspace_id,
      user_id: userId,
      module: dna.module,
      context: { test: true },
      variables_used: variables,
      tokens_used: 0,
      latency_ms: latencyMs,
      success: false,
      error_message: message,
    });

    return {
      systemInstruction: '',
      finalPrompt: '',
      response: '',
      tokensUsed: 0,
      latencyMs,
      success: false,
      error: message,
    };
  }
}

// ── Usage Logging ────────────────────────────────────────────

export async function logDnaUsage(
  entry: Omit<DnaUsageLog, 'id' | 'created_at'>,
): Promise<void> {
  try {
    await supabase.from('prompt_dna_usage_logs').insert(entry);
  } catch {
    // Silent catch — usage logging should never break the main flow
  }
}

export async function getDnaUsageLogs(dnaId: string, limit = 50): Promise<DnaUsageLog[]> {
  const { data, error } = await supabase
    .from('prompt_dna_usage_logs')
    .select('*')
    .eq('dna_id', dnaId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as DnaUsageLog[];
}
