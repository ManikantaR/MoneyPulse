'use client';

import { useState } from 'react';
import { Plus, Tags as TagsIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { useCategoryTree, useCreateCategory } from '@/lib/hooks/useCategories';
import { cn } from '@/lib/utils';
import type { CategoryTreeNode } from '@/lib/hooks/useCategories';

/** Default colors for the category color picker. */
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
  '#0891b2', '#0ea5e9', '#84cc16', '#a855f7', '#d946ef',
  '#b91c1c', '#db2777', '#92400e', '#059669', '#65a30d',
];

/** Default icons for the category icon picker. */
const PRESET_ICONS = [
  '💰', '💵', '🖥️', '🎉', '💸', '📊', '🏘️',
  '🛒', '🍽️', '⛽', '🔧', '🅿️', '🚘',
  '🛍️', '👗', '💻', '📷', '🏡', '🎮',
  '✈️', '🎬', '📱', '💡', '🏥', '🩺', '🦷', '👓', '💊', '🧘',
  '🏠', '🏦', '🔑', '📜', '🔩',
  '🌿', '🌱', '🔨', '🛋️',
  '🛡️', '🏛️', '📋', '💹',
  '📚', '🎓', '📖', '🏫',
  '🎵', '🎸', '🎼',
  '👪', '⚽', '🧸', '👕', '🍼',
  '💪', '🏋️', '🏅',
  '🐾', '💉', '🦴',
  '👤', '🎁', '🎀', '💝', '📈',
  '🔄', '💳', '📝',
];

/** Categories page — view and manage category tree. */
export default function CategoriesPage() {
  const { data: treeData, isLoading } = useCategoryTree();
  const createCategory = useCreateCategory();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    icon: '📝',
    color: '#6366f1',
    parentId: null as string | null,
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = treeData?.data ?? [];

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Handle new category creation. */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createCategory.mutateAsync({
      name: form.name,
      icon: form.icon,
      color: form.color,
      parentId: form.parentId,
    });
    setShowForm(false);
    setForm({ name: '', icon: '📝', color: '#6366f1', parentId: null });
  }

  /** Render a parent category card with its subcategories. */
  function renderCategory(node: CategoryTreeNode) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);

    return (
      <div key={node.id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        {/* Parent row */}
        <button
          type="button"
          onClick={() => hasChildren && toggleCollapse(node.id)}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
            hasChildren ? 'cursor-pointer hover:bg-[var(--muted)]' : 'cursor-default',
          )}
        >
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
            style={{ backgroundColor: node.color + '20' }}
          >
            {node.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{node.name}</p>
            {hasChildren && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {node.children.length} subcategor{node.children.length === 1 ? 'y' : 'ies'}
              </p>
            )}
          </div>
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: node.color }}
          />
          {hasChildren && (
            isCollapsed
              ? <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              : <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          )}
        </button>

        {/* Subcategory list */}
        {hasChildren && !isCollapsed && (
          <div className="border-t border-[var(--border)] bg-[var(--surface-container-low)]">
            {node.children.map((child) => (
              <div
                key={child.id}
                className="flex items-center gap-3 px-4 py-2.5 pl-14 hover:bg-[var(--muted)] transition-colors"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-sm"
                  style={{ backgroundColor: child.color + '20' }}
                >
                  {child.icon}
                </span>
                <p className="flex-1 text-sm">{child.name}</p>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: child.color }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Categories</h1>
          <p className="text-[var(--muted-foreground)]">
            Organize your transactions with categories
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add Category
        </button>
      </div>

      {/* Create Category Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm"
        >
          <h2 className="text-lg font-bold">New Category</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Groceries"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Parent Category</label>
              <select
                value={form.parentId ?? ''}
                onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              >
                <option value="">None (top-level)</option>
                {tree.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Icon picker */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold">Icon</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setForm({ ...form, icon })}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl border text-lg transition-colors',
                    form.icon === icon
                      ? 'border-[var(--primary)] bg-[var(--accent)]'
                      : 'border-[var(--border)] hover:bg-[var(--muted)]',
                  )}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, color })}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 transition-transform',
                    form.color === color
                      ? 'scale-110 border-[var(--foreground)]'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createCategory.isPending}
              className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {createCategory.isPending ? 'Creating...' : 'Create Category'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Category Tree */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : tree.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16">
          <TagsIcon className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No categories yet. Add your first category to start organizing.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((node) => renderCategory(node))}
        </div>
      )}
    </div>
  );
}
