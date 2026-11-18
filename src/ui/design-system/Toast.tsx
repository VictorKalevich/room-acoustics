import { useEffect, useState } from 'preact/hooks';
import { useSectionVisible } from '../components/SectionVisibility';

/** A non-blocking confirmation. Increment trigger for every successful action, including repeated clicks. */
export function Toast({ message, trigger }: { message: string; trigger: number }) {
  const [shown, setShown] = useState(false);
  const visible = useSectionVisible();
  useEffect(() => {
    if (!trigger) { setShown(false); return; }
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 2600);
    return () => window.clearTimeout(timer);
  }, [trigger, message]);
  useEffect(() => { if (!visible) setShown(false); }, [visible]);
  return <div class="toast" role="status" aria-live="polite" aria-atomic="true">
    {shown && visible && <span key={trigger} class="toast__message">{message}</span>}
  </div>;
}
