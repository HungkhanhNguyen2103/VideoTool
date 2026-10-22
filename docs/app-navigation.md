# App navigation

## Routes

| Route | Page | Main navigation state |
|---|---|---|
| `/production/init` | Create a project | Sản Xuất & Kịch Bản |
| `/production/:projectId/review` | Review and regenerate a script | Sản Xuất & Kịch Bản |
| `/production/:projectId/studio` | Scene studio and video export | Sản Xuất & Kịch Bản |
| `/production/:projectId/seo` | SEO and channel packaging | Sản Xuất & Kịch Bản |
| `/analytics` | All-channel analytics overview | Phân Tích Kênh |
| `/channels/:channelId/analytics` | Analytics for one channel | Phân Tích Kênh |

The “Menu 2” and “Menu 3” sidebar placeholders remain disabled. The project header and production tabs appear on production routes. Analytics pages have their own headers and hide that project-specific chrome. The project header keeps its direct link to the selected channel's analytics page.
