'use client';

import { useState } from 'react';
import { Plus, Tags as TagsIcon, Folder } from 'lucide-react';
import { useCategoryTree, useCreateCategory } from '@/lib/hooks/useCategories';
import { cn } from '@/lib/utils';
import type { CategoryTreeNode } from '@/lib/hooks/useCategories';

/** Default colors for the category color picker. */
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
];

/** Default icons for the category icon picker. */
const PRESET_ICONS = [
  '🏠', '🍔', '🚗', '💡', '🎬', '🛍️', '💊', '📚', '✈️', '💼',
  '🎮', '🏋️', '📱', '🎁', '💰', '📝',
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

  const tree = treeData?.data ?? [];

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

  /** Recursive category tree renderer. */
  function renderCategory(node: CategoryTreeNode, depth: number = 0) {
    return (
      <div key={node.id}>
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--muted)] transition-colors',
          )}
          style={{ paddingLeft: `${12 + depth * 24}px` }}
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm"
            style={{ backgroundColor: node.color + '20' }}
          >
            {node.icon}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">{node.name}</p>
            {node.children.length > 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {node.children.length} subcategor{node.children.length === 1 ? 'y' : 'ies'}
              </p>
            )}
          </div>
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: node.color }}
          />
        </div>
        {node.children.map((child) => renderCategory(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Organize your transactions with categories
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Category
        </button>
      </div>

      {/* Create Category Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Groceries"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Parent Category</label>
              <select
                value={form.parentId ?? ''}
                onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium">Icon</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setForm({ ...form, icon })}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors',
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
            <label className="mb-1 block text-sm font-medium">Color</label>
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

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createCategory.isPending}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createCategory.isPending ? 'Creating...' : 'Create Category'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]"
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16">
          <TagsIcon className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No categories yet. Add your first category to start organizing.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] py-2">
          {tree.map((node) => renderCategory(node))}
        </div>
      )}
    </div>
  );
}
