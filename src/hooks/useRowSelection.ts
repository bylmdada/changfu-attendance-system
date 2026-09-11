'use client';

import { useCallback, useMemo, useState } from 'react';

export function useRowSelection(availableIds: number[]) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const availableIdSet = useMemo(() => new Set(availableIds), [availableIds]);
  const selectedAvailableIds = selectedIds.filter((id) => availableIdSet.has(id));
  const allSelected = availableIds.length > 0 && availableIds.every((id) => selectedIds.includes(id));

  const toggle = useCallback((id: number) => {
    if (!availableIdSet.has(id)) return;

    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id]
    );
  }, [availableIdSet]);

  const toggleAll = useCallback(() => {
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      const shouldClear = availableIds.length > 0 && availableIds.every((id) => currentSet.has(id));

      if (shouldClear) {
        return current.filter((id) => !availableIdSet.has(id));
      }

      return Array.from(new Set([...current, ...availableIds]));
    });
  }, [availableIdSet, availableIds]);

  const clear = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const isSelected = useCallback((id: number) => selectedIds.includes(id), [selectedIds]);

  return {
    selectedIds: selectedAvailableIds,
    setSelectedIds,
    toggle,
    toggleAll,
    clear,
    isSelected,
    allSelected,
  };
}
