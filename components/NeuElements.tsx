import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BaseProps {
  className?: string;
  children?: React.ReactNode;
}

// A premium card with soft shadow and subtle border
export const NeuCard: React.FC<BaseProps> = ({ className, children }) => {
  return (
    <div className={twMerge(
      "bg-modern-card rounded-[2rem] shadow-neu-md border border-white/50 p-8 transition-all duration-500",
      "hover:shadow-neu-lg hover:-translate-y-0.5",
      className
    )}>
      {children}
    </div>
  );
};

// Premium Button
interface NeuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: 'default' | 'danger' | 'primary' | 'ghost' | 'glass' | 'gold';
}

export const NeuButton: React.FC<NeuButtonProps> = ({
  className,
  active,
  variant = 'default',
  children,
  ...props
}) => {
  const variants = {
    default: "bg-modern-bg text-modern-text border-transparent shadow-neu-sm hover:shadow-neu-md hover:text-modern-primary",
    primary: "bg-modern-accent text-white shadow-neu-sm hover:bg-indigo-700 border-transparent",
    secondary: "bg-modern-secondary text-white shadow-neu-sm hover:bg-blue-600 border-transparent",
    danger: "bg-red-50 text-red-600 border-red-100 hover:bg-red-100",
    ghost: "bg-transparent text-modern-muted hover:bg-modern-bg border-transparent",
    gold: "bg-amber-400 text-white border-transparent shadow-neu-sm hover:brightness-105 active:scale-95",
    glass: "bg-white/40 backdrop-blur-md border-white/40 text-modern-text hover:bg-white/60",
  };

  return (
    <button
      className={twMerge(
        "rounded-2xl px-6 py-3 font-bold transition-all duration-300 outline-none border",
        "flex items-center justify-center gap-2 active:scale-95",
        variants[variant],
        active && "bg-modern-bg text-modern-accent shadow-neu-inset border-modern-accent/20",
        props.disabled && "opacity-40 cursor-not-allowed grayscale",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

// Premium Input
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
      {label && <label className="ml-1 text-[11px] font-black text-modern-muted uppercase tracking-[0.2em]">{label}</label>}
      <div className={twMerge(
        "relative rounded-2xl bg-modern-bg shadow-neu-inset border border-transparent transition-all duration-500",
        "focus-within:border-modern-accent/30 focus-within:shadow-neu-sm",
        hasError && "border-red-300 ring-4 ring-red-50",
        className
      )}>
        <input
          className="w-full bg-transparent border-none px-5 py-4 text-modern-primary font-medium placeholder-slate-400 focus:outline-none focus:ring-0"
          {...props}
        />
      </div>
    </div>
  );
};

export const NeuBadge: React.FC<{ children: React.ReactNode; variant?: 'gold' | 'green' | 'red' | 'yellow' | 'stone' | 'slate' | 'indigo' | 'blue'; className?: string }> = ({ children, variant = 'gold', className }) => {
  const variants = {
    gold: "bg-amber-50 text-amber-600 border-amber-100",
    stone: "bg-slate-100 text-slate-600 border-slate-200",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-emerald-50 text-emerald-600 border-emerald-100",
    red: "bg-red-50 text-red-600 border-red-100",
    yellow: "bg-amber-50 text-amber-600 border-amber-100",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <span className={twMerge("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border", variants[variant], className)}>
      {children}
    </span>
  );
};

// Premium TextArea
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
      {label && <label className="ml-1 text-[11px] font-black text-modern-muted uppercase tracking-[0.2em]">{label}</label>}
      <div className={twMerge(
        "relative rounded-2xl bg-modern-bg shadow-neu-inset border border-transparent transition-all duration-500",
        "focus-within:border-modern-accent/30 focus-within:shadow-neu-sm",
        hasError && "border-red-300 ring-4 ring-red-50",
        className
      )}>
        <textarea
          className="w-full bg-transparent border-none px-5 py-4 text-modern-primary font-medium placeholder-slate-400 focus:outline-none focus:ring-0 resize-none"
          rows={3}
          {...props}
        />
      </div>
    </div>
  );
};
