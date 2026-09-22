<script lang="ts">
  /**
   * "Who sees this": the audience for one part of your public profile, set
   * right on the part itself. Three steps — only you, the people you follow,
   * or anyone. It saves the moment you pick, so there is no separate save.
   * Only the owner ever sees this; a visitor sees the section or doesn't.
   */
  import type { ShareLevel } from '$lib/api';
  import ChoiceGroup from './ChoiceGroup.svelte';

  let { level, onchange, label }: {
    level: ShareLevel;
    onchange: (level: ShareLevel) => void;
    label: string;
  } = $props();

  const LEVELS: { value: ShareLevel; label: string }[] = [
    { value: 'private', label: 'Only me' },
    { value: 'friends', label: 'People I follow' },
    { value: 'public', label: 'Anyone' }
  ];
</script>

<ChoiceGroup
  options={LEVELS}
  value={level}
  onchange={(v) => onchange(v as ShareLevel)}
  label="Who sees {label}"
  size="sm"
  fill
/>
