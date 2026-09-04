// Patch global : traduit automatiquement les <Text>, placeholders de <TextInput>
// et Alert.alert quand la langue est l'anglais. Aucune modification des écrans requise.
import { Text, TextInput, Alert } from "react-native";
import { t, getLang } from "./index";

function trStr(s: string): string {
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m) return t(s);
  return m[1] + t(m[2]) + m[3];
}

function trChildren(c: any): any {
  if (typeof c === "string") return trStr(c);
  if (Array.isArray(c)) return c.map(trChildren);
  return c;
}

export function installI18nPatch() {
  const T: any = Text;
  if (!T.__i18n && typeof T.render === "function") {
    const orig = T.render;
    T.render = function (props: any, ref: any) {
      if (getLang() === "en" && props?.children != null) {
        props = { ...props, children: trChildren(props.children) };
      }
      return orig.call(this, props, ref);
    };
    T.__i18n = true;
  }
  const I: any = TextInput;
  if (!I.__i18n && typeof I.render === "function") {
    const orig = I.render;
    I.render = function (props: any, ref: any) {
      if (getLang() === "en" && typeof props?.placeholder === "string") {
        props = { ...props, placeholder: t(props.placeholder) };
      }
      return orig.call(this, props, ref);
    };
    I.__i18n = true;
  }
  const A: any = Alert;
  if (!A.__i18n && typeof Alert.alert === "function") {
    const origAlert = Alert.alert.bind(Alert);
    Alert.alert = (title: any, message?: any, buttons?: any, options?: any) => {
      if (getLang() === "en") {
        if (typeof title === "string") title = t(title);
        if (typeof message === "string") message = t(message);
        if (Array.isArray(buttons)) {
          buttons = buttons.map((b: any) =>
            b && typeof b.text === "string" ? { ...b, text: t(b.text) } : b);
        }
      }
      return origAlert(title, message, buttons, options);
    };
    A.__i18n = true;
  }
}
