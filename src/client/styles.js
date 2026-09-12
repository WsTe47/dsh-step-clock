/**
 * @climber47/dsh-step-clock — browser half styles.
 *
 * Kept beside the component so the bundle's injected stylesheet has a readable
 * source. Colours and geometry come from dsh theme tokens and the composer
 * layout variables, with fallbacks so a missing token degrades instead of
 * breaking the bar. The `--dsh-composer-*` variables are declared on the
 * conversation root, which is an ancestor of both dock seats.
 *
 * @module @climber47/dsh-step-clock/client/styles
 */

export const CSS = [
  // The dock row is full viewport width; this wrapper centres a composer-width
  // column inside it, mirroring the shipped GoalBar dock convention.
  '.dsh-stepclock-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));margin:0 auto;}',
  '.dsh-stepclock-root{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width,780px) - 4 * var(--dsh-composer-dock-inset,8px));margin:0 auto;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;}',
  // A filled dot marks real activity; a hollow one marks an idle bar.
  '.dsh-stepclock-dot{flex:none;align-self:center;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);}',
  '.dsh-stepclock-dot-idle{flex:none;align-self:center;width:8px;height:8px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);}',
  '.dsh-stepclock-say{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);}',
  '.dsh-stepclock-where{flex:none;opacity:.6;font-size:12px;}',
  '.dsh-stepclock-time{flex:none;color:var(--dsw-alias-brand-primary);font-weight:600;font-size:15px;}',
  '.dsh-stepclock-chip{flex:none;max-width:22em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:16px;}',
  '.dsh-stepclock-mono{font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}',
].join('')
