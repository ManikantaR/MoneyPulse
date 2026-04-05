'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@moneypulse/shared';

/** Category with resolved children for tree display. */
export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

/** Fetch flat list of all categories. */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: Category[] }>('/categories'),
  });
}

/** Build a nested tree from the flat depth-annotated list returned by the API. */
function buildTree(
  flat: (Category & { depth?: number })[],
): CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];
  for (const item of flat) {
    map.set(item.id, { ...item, children: [] });
  }
  for (const node of map.values()) {
    if (node.parentId) {
      const parent = map.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Fetch category tree (parent → children hierarchy). */
export function useCategoryTree() {
  return useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () =>
      api.get<{ data: (Category & { depth?: number })[] }>('/categories/tree'),
    select: (res) => ({ data: buildTree(res.data) }),
  });
}

/** Create a new category. */
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryInput) =>
      api.post<{ data: Category }>('/categories', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/** Update an existing category. */
export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCategoryInput & { id: string }) =>
      api.patch<{ data: Category }>(`/categories/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/** Delete a category. */
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
