import { useEffect, useRef, useCallback, useState } from 'react';

interface UseIdleTimerOptions {
  /** Total idle time in ms before auto-logout (default: 10 min) */
  idleTimeout?: number;
  /** Time before logout to show warning in ms (default: 1 min) */
  warningBefore?: number;
  onLogout: () => void;
}

export interface IdleTimerState {
  /** True when the warning countdown is showing */
  isWarning: boolean;
  /** Seconds remaining until auto-logout (only meaningful when isWarning=true) */
  secondsLeft: number;
  /** Call this to reset the timer (e.g., user clicks "Stay Logged In") */
  reset: () => void;
}

const ACTIVITY_EVENTS = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'wheel', 'click',
];

export function useIdleTimer({
  idleTimeout = 10 * 60 * 1000,   // 10 minutes
  warningBefore = 60 * 1000,      // warn 1 minute before
  onLogout,
}: UseIdleTimerOptions): IdleTimerState {
  const [isWarning, setIsWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);

  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivity = useRef<number>(Date.now());

  const clearAllTimers = useCallback(() => {
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (countdownInterval.current) clearInterval(countdownInterval.current);
  }, []);

  const startWarningCountdown = useCallback((remaining: number) => {
    setIsWarning(true);
    setSecondsLeft(Math.ceil(remaining / 1000));

    countdownInterval.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          if (countdownInterval.current) clearInterval(countdownInterval.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const reset = useCallback(() => {
    lastActivity.current = Date.now();
    setIsWarning(false);
    setSecondsLeft(Math.ceil(warningBefore / 1000));
    clearAllTimers();

    // Schedule warning
    warningTimer.current = setTimeout(() => {
      startWarningCountdown(warningBefore);
    }, idleTimeout - warningBefore);

    // Schedule logout
    logoutTimer.current = setTimeout(() => {
      onLogout();
    }, idleTimeout);
  }, [idleTimeout, warningBefore, onLogout, clearAllTimers, startWarningCountdown]);

  // Listen to user activity
  useEffect(() => {
    const handleActivity = () => {
      // Only reset if currently in warning state OR it's been too long since last activity
      const now = Date.now();
      if (isWarning || now - lastActivity.current > 5000) {
        lastActivity.current = now;
        reset();
      } else {
        lastActivity.current = now;
      }
    };

    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, handleActivity));
    };
  }, [isWarning, reset]);

  // Start timer on mount
  useEffect(() => {
    reset();
    return () => clearAllTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isWarning, secondsLeft, reset };
}
