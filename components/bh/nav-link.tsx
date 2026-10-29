"use client";
import {useRouter} from "next/navigation";

// In-app link. vinext's <Link> throws in production builds ("e is not a function": its click
// handler lazy-loads navigateClientSide and gets undefined), so this calls router.push(), which
// reaches the same navigation directly. A plain <a href> remains for new-tab and no-JS use.
export function NavLink({href, onMouseEnter, onClick, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {href: string}) {
  const router = useRouter();
  return <a {...props} href={href}
    onMouseEnter={e => { onMouseEnter?.(e); try { router.prefetch(href); } catch {} }}
    onClick={e => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || props.target) return;
      e.preventDefault();
      router.push(href);
    }}/>;
}
