declare const __VITE_API_BASE_URL__: string;
declare const __VITE_WEB_BASE_URL__: string;
declare const __VITE_EXTENSION_REDIRECT_PATH__: string;

declare module "*.css?inline" {
  const css: string;
  export default css;
}
