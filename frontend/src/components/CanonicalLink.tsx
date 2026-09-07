// Balise canonique par page (web uniquement) — SEO du site public.
// Normalise le domaine vers https://www.casaneo.pro quand le site est servi sur casaneo.pro.
import { useEffect } from "react";
import { Platform } from "react-native";
import { usePathname } from "expo-router";

export default function CanonicalLink() {
  const pathname = usePathname();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let origin = window.location.origin;
    if (/(^|\.)casaneo\.pro$/i.test(window.location.hostname)) {
      origin = "https://www.casaneo.pro";
    }
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = origin + (pathname || "/");
  }, [pathname]);
  return null;
}
