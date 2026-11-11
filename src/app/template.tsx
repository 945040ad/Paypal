/** Re-mounts on every navigation, so each page arrives with the same short entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
