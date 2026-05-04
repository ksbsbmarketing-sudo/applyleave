import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BaseProps {
  className?: string;
  children?: React.ReactNode;
}

// A standard neumorphic card/container
export const NeuCard: React.FC<BaseProps> = ({ className, children }) => {
  return (
    <div className={twMerge("bg-neu-base rounded-[20px] shadow-neu-flat p-6 transition-all duration-300", className)}>
      {children}
    </div>
  );
};

// Neumorphic Button
interface NeuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: 'default' | 'danger' | 'primary';
}

export const NeuButton: React.FC<NeuButtonProps> = ({
  className,
  active,
  variant = 'default',
  children,
  ...props
}) => {
  return (
    <button
      className={twMerge(
        "bg-neu-base rounded-[12px] px-6 py-3 font-semibold text-gray-700 transition-all duration-200 outline-none",
        "shadow-neu-flat hover:translate-y-[-2px]",
        "active:shadow-neu-pressed active:translate-y-[0px]",
        active && "shadow-neu-pressed text-blue-600",
        variant === 'danger' && "text-red-500 hover:text-red-600",
        variant === 'primary' && "text-blue-600 hover:text-blue-700",
        props.disabled && "opacity-50 cursor-not-allowed hover:translate-y-0 shadow-neu-flat",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

// Neumorphic Input
interface NeuInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hasError?: boolean;
}

export const NeuInput: React.FC<NeuInputProps> = ({
  className,
  label,
  hasError,
  ...props
}) => {
  return (
    <div className="flex flex-col gap-2 w-full">
      {label && <label className="ml-2 text-sm font-bold text-gray-500 tracking-wide">{label}</label>}
      <div className={twMerge(
        "relative rounded-[12px] bg-neu-base transition-all duration-300",
        "shadow-neu-pressed-sm",
        hasError && "shadow-warning-glow ring-1 ring-red-400/30",
        className
      )}>
        <input
          className="w-full bg-transparent border-none px-4 py-3 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-0"
          {...props}
        />
      </div>
    </div>
  );
};
export const NeuBadge: React.FC<{ children: React.ReactNode; variant?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' }> = ({ children, variant = 'blue' }) => {
  const variants = {
    blue: "bg-blue-100 text-blue-600 border-blue-200",
    green: "bg-green-100 text-green-600 border-green-200",
    red: "bg-red-100 text-red-600 border-red-200",
    yellow: "bg-yellow-100 text-yellow-600 border-yellow-200",
    purple: "bg-purple-100 text-purple-600 border-purple-200",
  };
  return (
    <span className={twMerge("px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border", variants[variant])}>
      {children}
    </span>
  );
};

// Neumorphic TextArea
interface NeuTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hasError?: boolean;
}

export const NeuTextArea: React.FC<NeuTextAreaProps> = ({
  className,
  label,
  hasError,
  ...props
}) => {
  return (
    <div className="flex flex-col gap-2 w-full">
      {label && <label className="ml-2 text-sm font-bold text-gray-500 tracking-wide">{label}</label>}
      <div className={twMerge(
        "relative rounded-[12px] bg-neu-base transition-all duration-300",
        "shadow-neu-pressed-sm",
        hasError && "shadow-warning-glow ring-1 ring-red-400/30",
        className
      )}>
        <textarea
          className="w-full bg-transparent border-none px-4 py-3 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-0 resize-none"
          rows={3}
          {...props}
        />
      </div>
    </div>
  );
};
