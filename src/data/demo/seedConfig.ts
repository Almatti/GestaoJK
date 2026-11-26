import { SETTING_DEFS } from '@/config/settings';
import { DEFAULT_TEMPLATES } from '@/config/messageTemplates';
export const SETTINGS_SEED: [string, unknown, string][] = SETTING_DEFS.map((d) => [d.key, d.default, d.label]);
export const MESSAGE_TEMPLATE_SEED = DEFAULT_TEMPLATES;
