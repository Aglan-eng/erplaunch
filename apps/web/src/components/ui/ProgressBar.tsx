import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number; // 0–100
  className?: string;
  size?: 'sm' | 'md';
  color?: 'brand' | 'green' | 'amber';
}

export function ProgressBar({ value, className, size = 'md', color = 'brand' }: ProgressBarProps) {
  return (
    <div
      className={cn(
        'w-full rounded-full bg-gray-100 overflow-hidden',
        { 'h-1.5': size === 'sm', 'h-2': size === 'md' },
        className
      )}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', {
          'bg-brand-600': color === 'brand',
          'bg-green-500': color === 'green',
          'bg-amber-500': color === 'amber',
        })}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
