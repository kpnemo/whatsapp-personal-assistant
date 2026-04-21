import { defineConfig } from "vitepress";

export default defineConfig({
  title: "WhatsApp Personal Assistant",
  description: "Self-hosted personal AI assistant for WhatsApp",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/quickstart" },
      { text: "GitHub", link: "https://github.com/<owner>/whatsapp-personal-assistant" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Quickstart", link: "/guide/quickstart" },
          { text: "Deploy", link: "/guide/deploy" },
          { text: "Architecture", link: "/guide/architecture" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: "https://github.com/<owner>/whatsapp-personal-assistant" },
    ],
  },
});
