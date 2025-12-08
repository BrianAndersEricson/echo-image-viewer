# Echo

A local image gallery viewer named after the Greco-Roman nymph Echo. Browse and view image galleries with comic/manga reading modes, VIM-style navigation, and non-destructive editing.

## Features

- **In-browser folder selection** - Browse and select any mounted folder after the app starts
- **Recent galleries** - Quick access to recently viewed folders
- **All image formats** - JPG, PNG, GIF, WebP, TIFF, BMP, SVG, and RAW formats (CR2, NEF, ARW, DNG, etc.)
- **Comic/Manga modes** - Left-to-right or right-to-left reading directions
- **VIM keybindings** - Navigate with h/l, j/k, g/G, q to quit
- **Click navigation** - Click left/right edges to navigate, center to show menu
- **Non-destructive editing** - Rotate, flip, crop, resize - saves as new file
- **File management** - Delete unwanted images directly from the viewer
- **Optional authentication** - Simple login system for network deployments
- **Dark/Light themes** - Clean aesthetic with theme toggle
- **Reverse proxy ready** - Works behind nginx, Caddy, or other proxies

## Quick Start

### Docker Compose

```bash
git clone <repository-url>
cd echo-image-viewer
docker compose up -d
```

Open http://localhost:8080 and click "Browse Folders" to select a gallery.

### Configuration

Edit `docker-compose.yml` to mount your directories:

```yaml
volumes:
  # Mount paths you want to browse
  - /path/to/photos:/mnt/Photos:ro      # read-only
  - /path/to/manga:/mnt/Manga:rw        # read-write for editing/deleting
  - echo-data:/app/data                  # persist auth credentials
environment:
  - BROWSE_ROOT=/mnt
  - AUTH_ENABLED=false                   # set to "true" for login
```

### Network/LXC Deployment

For running on a server accessible over the network:

1. Set `AUTH_ENABLED=true` in docker-compose.yml
2. Mount your media directories
3. On first access, you'll be prompted to create login credentials
4. Credentials are stored in the `echo-data` volume

Example for a manga server:

```yaml
services:
  echo:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - /srv/manga:/mnt/Manga:ro
      - echo-data:/app/data
    environment:
      - BROWSE_ROOT=/mnt
      - AUTH_ENABLED=true
    restart: unless-stopped

volumes:
  echo-data:
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name manga.example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

## Keyboard Shortcuts

Press `?` at any time to see all available shortcuts.

### Gallery View

| Key | Action |
|-----|--------|
| `?` | Show keyboard shortcuts |

### Viewer

| Key | Action |
|-----|--------|
| `h` / `Left` | Previous image |
| `l` / `Right` | Next image |
| `j` / `Down` | Next image |
| `k` / `Up` | Previous image |
| `g` | First image |
| `G` | Last image |
| `Space` | Toggle menu |
| `m` | Toggle manga/comic mode |
| `e` | Enter edit mode |
| `Delete` / `x` | Delete current image |
| `q` / `Escape` | Close viewer |
| `?` | Show keyboard shortcuts |

### Edit Mode

| Key | Action |
|-----|--------|
| `r` | Rotate right 90 degrees |
| `R` | Rotate left 90 degrees |
| `h` | Flip horizontal |
| `v` | Flip vertical |
| `c` | Crop |
| `z` | Undo |
| `Z` | Redo |
| `s` | Save edited image |
| `Escape` | Exit edit mode |

## Click Zones

The viewer is divided into three click zones:

- **Left 25%** - Previous image
- **Center 50%** - Toggle menu
- **Right 25%** - Next image

In manga mode, left/right are reversed.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSE_ROOT` | `/mnt` | Base path for browsing inside container |
| `AUTH_ENABLED` | `false` | Enable login authentication |
| `SESSION_EXPIRY_HOURS` | `168` | Session duration (default: 1 week) |

## Supported Formats

### Standard
- JPEG, PNG, GIF (including animated), WebP, BMP, TIFF, ICO, SVG

### RAW
- Canon (CR2, CR3), Nikon (NEF), Sony (ARW), Adobe (DNG)
- Olympus (ORF), Panasonic (RW2), Pentax (PEF), Samsung (SRW)

## Local Development

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
BROWSE_ROOT=/home AUTH_ENABLED=false uvicorn backend.main:app --reload --port 8080
```

## Project Structure

```
echo-image-viewer/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── auth.py              # Authentication module
│   └── image_processor.py   # Image manipulation
├── frontend/
│   ├── index.html           # Main application
│   ├── login.html           # Login page
│   ├── styles.css           # Styling
│   ├── app.js               # Client logic
│   └── favicon.svg          # Logo
├── docker-compose.yml
├── Dockerfile
└── requirements.txt
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/status` | GET | Check auth status |
| `/api/auth/setup` | POST | First-time credential setup |
| `/api/auth/login` | POST | Login |
| `/api/auth/logout` | POST | Logout |
| `/api/browse` | GET | Browse filesystem for folder selection |
| `/api/folders` | GET | List folders in gallery |
| `/api/images` | GET | List images in folder |
| `/api/image/{path}` | GET | Get image (supports thumbnail, width, height params) |
| `/api/edit-upload` | POST | Save edited image |
| `/api/delete` | DELETE | Delete an image |
| `/api/file-info` | GET | Get file metadata |

## License

MIT
