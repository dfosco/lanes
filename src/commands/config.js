// Config command - view and edit lanes configuration
import {
  readConfig, getConfigValue, setConfigValue, DEFAULT_CONFIG, getConfigPath,
  getModelPreference, getUserModelPreference, MODEL_PREFERENCE_KEYS, MODEL_ROUTING_POLICY_KEY,
  getModelRoutingPolicy, setModelRoutingPolicy, setModelPreference, unsetModelPreference,
} from '../lib/config.js';
import { getRepoRoot } from '../lib/core.js';
import { effectiveProjectId, registerProject } from '../lib/registry.js';
import fs from 'fs';

export function runConfigCommand(args) {
  const [key, value] = args;
  if (args.length === 1 && (key === '--help' || key === '-h')) return showHelp();
  if (args.includes('--user') || args.includes('--provider')) return runScopedModelConfig(args);
  if (args.length > 2) throw new Error('Usage: lanes config <key> [value] or --lane-max-active-agents <N>');
  if (key === '--lane-max-active-agents') {
    if (args.length !== 2) throw new Error('--lane-max-active-agents requires a positive integer');
    return setConfig('lane_max_active_agents', value);
  }
  if (key?.startsWith('-')) throw new Error(`Unknown config option: ${key}`);
  
  // No args: show all config
  if (!key) {
    return showAllConfig();
  }

  if (MODEL_PREFERENCE_KEYS.includes(key)) {
    if (value === '--unset') return unsetPreference(key, 'project');
    if (args.length === 1) return showConfigKey(key);
    return setPreference(key, value, 'project');
  }
  
  // One arg: show specific key
  if (args.length === 1) {
    return showConfigKey(key);
  }
  
  // Two args: set value
  return setConfig(key, value);
}

function runScopedModelConfig(args) {
  let scope = 'project';
  let provider;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--user') { scope = 'user'; continue; }
    if (args[i] === '--provider') {
      provider = args[++i];
      if (!provider) throw new Error('--provider requires a provider ID from the host catalog');
      continue;
    }
    positional.push(args[i]);
  }
  if (positional.length < 1 || positional.length > 2) {
    throw new Error('Usage: lanes config [--user] [--provider <provider-id>] <model-key|model_routing_policy> [value|--unset]');
  }
  const [key, value] = positional;
  if (key === MODEL_ROUTING_POLICY_KEY) {
    if (provider) throw new Error('model_routing_policy is shared across providers; configure providerOrder inside the policy');
    if (value === undefined) {
      console.log(JSON.stringify(getModelRoutingPolicy(scope === 'user' ? undefined : getRepoRoot(), { scope: scope === 'user' ? 'user' : undefined }), null, 2));
      return;
    }
    if (value === '--unset') throw new Error('Clearing model_routing_policy is not supported; set an explicit validated version 1 policy');
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error('model_routing_policy must be valid JSON'); }
    const saved = setModelRoutingPolicy(parsed, { scope, repoRoot: scope === 'project' ? getRepoRoot() : undefined });
    console.log(JSON.stringify(saved, null, 2));
    return;
  }
  if (!MODEL_PREFERENCE_KEYS.includes(key)) throw new Error(`Unknown model preference: ${key}`);
  if (scope === 'user' && value === undefined) {
    console.log(getUserModelPreference(key, { provider }) ?? '(not set)');
    return;
  }
  if (value === undefined) {
    console.log(getModelPreference(key, getRepoRoot(), { provider }));
    return;
  }
  if (value === '--unset') return unsetPreference(key, scope, provider);
  return setPreference(key, value, scope, provider);
}

function showAllConfig() {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot, { strict: true });
  config.lane_max_active_agents = getConfigValue('lane_max_active_agents', repoRoot);
  config.project_id = effectiveProjectId(repoRoot);
  const configPath = getConfigPath(repoRoot);
  const exists = fs.existsSync(configPath);
  
  console.log('📋 lanes configuration\n');
  
  if (!exists) {
    console.log(`(using defaults - no ${configPath} file)\n`);
  }
  
  for (const [key, value] of Object.entries(config)) {
    if (MODEL_PREFERENCE_KEYS.includes(key)) continue;
    const isDefault = config[key] === DEFAULT_CONFIG[key];
    const marker = isDefault ? '' : ' *';
    console.log(`  ${key}: ${value}${marker}`);
  }

  for (const key of MODEL_PREFERENCE_KEYS) {
    console.log(`  ${key}: ${getModelPreference(key, repoRoot)} (resolved)`);
  }
  
  console.log('\n* = modified from default');
  console.log('');
  showHelp();
}

function showHelp() {
  console.log(`Usage: lanes config [key] [value]
  lanes config                             Show configuration
  lanes config <key>                        Read a value
  lanes config <key> <value>                Set a value
  lanes config <model-key> --unset         Remove a project model override
  lanes config --user <model-key> [value]  Read or set a user model preference
  lanes config --user <model-key> --unset  Remove a user model override
  lanes config [--user] --provider <id> <model-key> [value|--unset]
                                           Read or set provider-scoped defaults
  lanes config [--user] model_routing_policy [<JSON>]
                                           Read or set routing and usage thresholds
  lanes config --lane-max-active-agents <N>  Set the per-Lane resource fallback

Provider preferences resolve project provider > project global > user provider > user global > built-in. Built-in values are
gpt-6.1-sol/high for Lane Managers and gpt-6-luna/high for Lane Devs.
The --user forms work outside a Git repository. Reading a model key without
--user returns its effective value; a user-scoped read shows only that override.
Model identifiers are stored as provided; availability is determined at dispatch.
Keys: lane_manager_model, lane_manager_reasoning_effort, lane_dev_model,
lane_dev_reasoning_effort.

Delivery preferences:
lane_dev_max_tasks defaults to 3 Tasks per Lane Dev assignment. A worker folds
promptly when its assigned Tasks finish, even below the cap or while Goal review
is pending. Folding closes its native session/tab and owned process. Normal folds
require latest context attached to each Goal and acknowledged by the manager;
critical resource folds close immediately and preserve available context after.
lane_validation_mode defaults to human and may be
agent. Human review is the default when Goal review is requested, but it is not
required for every Goal. An unreviewed Goal may close with a not-reviewed label;
named human gates still apply. lane_commit_mode defaults to
after_validation and may be manual.
lane_pr_mode defaults to none and may be prepare, draft, or ready. These settings
guide workflow; they do not enforce scheduling, approve commits, or authorize
external actions. PR modes describe desired output only. Manual commit mode
leaves an explicit commit handoff for the designated coordinator.

Read and set delivery preferences with lanes config <key> [value]. Invalid
values and malformed stored delivery settings fail visibly and remain on disk.

lane_max_active_agents defaults to 5 workers per Lane, excluding its manager.
It is only the fallback when resource management is unavailable, stale or disabled.
Fresh live capacity supersedes it; explicit user ceilings and native quotas remain.
N must be a positive safe integer (decimal digits).
Read back the numeric value: lanes config lane_max_active_agents

Lane Manager maintains two-way resource-manager contact and reports actual closure.
Idle and finished-but-unclosed sessions still occupy capacity; unknown is not free.
The fallback is dispatch policy, not a native process limit. Changing its stored
value does not itself terminate workers. Cloud execution does not bypass it.`);
}

function showConfigKey(key) {
  const repoRoot = getRepoRoot();

  if (key === MODEL_ROUTING_POLICY_KEY) {
    console.log(JSON.stringify(getModelRoutingPolicy(repoRoot), null, 2));
    return;
  }
  
  if (MODEL_PREFERENCE_KEYS.includes(key)) {
    console.log(getModelPreference(key, repoRoot));
    return;
  }

  if (!(key in DEFAULT_CONFIG)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
    process.exit(1);
  }
  
  console.log(key === 'project_id' ? effectiveProjectId(repoRoot) : getConfigValue(key, repoRoot));
}

function setPreference(key, value, scope, provider) {
  try {
    const options = { scope, provider, ...(scope === 'user' ? {} : { repoRoot: getRepoRoot() }) };
    const preference = setModelPreference(key, value, options);
    console.log(`✅ Set ${scope}${provider ? ` ${provider}` : ''} ${key} = ${preference}`);
  } catch (error) {
    throw new Error(error.message, { cause: error });
  }
}

function unsetPreference(key, scope, provider) {
  try {
    const options = { scope, provider, ...(scope === 'user' ? {} : { repoRoot: getRepoRoot() }) };
    unsetModelPreference(key, options);
    console.log(`✅ Removed ${scope}${provider ? ` ${provider}` : ''} override for ${key}`);
  } catch (error) {
    throw new Error(error.message, { cause: error });
  }
}

function setConfig(key, value) {
  try {
    const repoRoot = getRepoRoot();
    const config = setConfigValue(key, value, repoRoot);
    if (key === 'project_id') registerProject(repoRoot);
    console.log(`✅ Set ${key} = ${config[key]}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
