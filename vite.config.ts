import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// The self-hosted Node server owns persistence and proxies Audiobookshelf.
export default defineConfig({plugins:[react()],css:{postcss:{plugins:[tailwindcss()]}},resolve:{dedupe:['react','react-dom'],alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},optimizeDeps:{include:['react','react-dom/client','@base-ui/react/popover','@base-ui/react/button','@base-ui/react/checkbox','@base-ui/react/dialog','@base-ui/react/input','@base-ui/react/select','@base-ui/react/slider','@base-ui/react/tabs']},server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:8787'}},build:{outDir:'dist'}});
