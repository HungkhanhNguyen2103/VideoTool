export function layoutNavigationState(pathname: string) {
  const analyticsActive = pathname === '/analytics' || pathname.startsWith('/channels/');
  const productionActive = pathname.startsWith('/production/');
  return { productionActive, analyticsActive, showProjectChrome: !analyticsActive };
}
