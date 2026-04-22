import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  variant?: 'default' | 'block' | 'warn' | 'info' | 'success';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        {
          'bg-gray-100 text-gray-700': variant === 'default',
          'bg-red-100 text-red-700': variant === 'block',
          'bg-amber-100 text-amber-700': variant === 'warn',
          'bg-blue-100 text-blue-700': variant === 'info',
          'bg-green-100 text-green-700': variant === 'success',
        },
        className
      )}
    >
      {children}
    </span>
  );
}
