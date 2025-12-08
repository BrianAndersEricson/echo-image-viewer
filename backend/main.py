"""
Echo Image Viewer - A local image gallery viewer
Named after the Greco-Roman nymph Echo
"""

import os
import io
import mimetypes
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Response, Header, UploadFile, File, Form, Cookie, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel

from .image_processor import ImageProcessor
from . import auth

app = FastAPI(title="Echo Image Viewer", version="1.0.0")


# Auth middleware
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Check authentication for protected routes."""
    path = request.url.path

    # Always allow auth-related endpoints and login page
    public_paths = ["/api/auth/", "/login.html", "/login"]
    if any(path.startswith(p) for p in public_paths):
        return await call_next(request)

    # If auth is disabled, allow everything
    if not auth.AUTH_ENABLED:
        return await call_next(request)

    # Check for valid session
    session_token = request.cookies.get("echo_session")

    if auth.validate_session(session_token):
        # Valid session - allow the request
        return await call_next(request)

    # Not authenticated
    # For API requests, return 401
    if path.startswith("/api/"):
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"}
        )

    # For static assets (js, css, images, manifest), return 401 to avoid broken pages
    static_extensions = [".js", ".css", ".png", ".jpg", ".svg", ".ico", ".woff", ".woff2", ".json"]
    if any(path.endswith(ext) for ext in static_extensions):
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"}
        )

    # For page requests, show login page
    return FileResponse("frontend/login.html")


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    username: str
    password: str


@app.get("/api/auth/status")
async def auth_status():
    """Get authentication status."""
    return auth.get_auth_status()


@app.post("/api/auth/setup")
async def auth_setup(request: SetupRequest):
    """Set up initial credentials (first run only)."""
    if not auth.AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Authentication is not enabled")

    if auth.is_setup_complete():
        raise HTTPException(status_code=400, detail="Setup already complete")

    if len(request.username) < 1:
        raise HTTPException(status_code=400, detail="Username is required")

    if len(request.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    if auth.setup_credentials(request.username, request.password):
        # Auto-login after setup
        token = auth.create_session(request.username)
        response = JSONResponse(content={"success": True})
        response.set_cookie(
            key="echo_session",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=auth.SESSION_EXPIRY_HOURS * 3600
        )
        return response

    raise HTTPException(status_code=500, detail="Failed to save credentials")


@app.post("/api/auth/login")
async def auth_login(request: LoginRequest):
    """Log in with credentials."""
    if not auth.AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Authentication is not enabled")

    if not auth.is_setup_complete():
        raise HTTPException(status_code=400, detail="Setup not complete")

    if auth.verify_credentials(request.username, request.password):
        token = auth.create_session(request.username)
        response = JSONResponse(content={"success": True})
        response.set_cookie(
            key="echo_session",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=auth.SESSION_EXPIRY_HOURS * 3600
        )
        return response

    raise HTTPException(status_code=401, detail="Invalid username or password")


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """Log out and destroy session."""
    session_token = request.cookies.get("echo_session")
    if session_token:
        auth.destroy_session(session_token)

    response = JSONResponse(content={"success": True})
    response.delete_cookie("echo_session")
    return response

# Browse root - the base path users can browse from (typically /mnt in Docker)
BROWSE_ROOT = Path(os.environ.get("BROWSE_ROOT", "/mnt"))

# Legacy support: if GALLERY_ROOT is set, use it as the default
DEFAULT_GALLERY = os.environ.get("GALLERY_ROOT", "")

# Supported image extensions
IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
    ".tiff", ".tif", ".ico", ".svg",
    # RAW formats
    ".raw", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw"
}

RAW_EXTENSIONS = {".raw", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw"}


class FolderInfo(BaseModel):
    name: str
    path: str
    has_images: bool
    has_subfolders: bool
    thumbnail: Optional[str] = None


class ImageInfo(BaseModel):
    name: str
    path: str
    size: int
    is_raw: bool


class EditRequest(BaseModel):
    path: str
    operations: list[dict]  # e.g., [{"type": "rotate", "angle": 90}, {"type": "crop", "x": 0, "y": 0, "w": 100, "h": 100}]
    output_prefix: str = ""
    output_suffix: str = "_edited"
    gallery_root: str = ""


class SetGalleryRequest(BaseModel):
    path: str


class BrowseItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    has_images: bool = False


def is_image_file(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS


def is_raw_file(path: Path) -> bool:
    return path.suffix.lower() in RAW_EXTENSIONS


def is_svg_file(path: Path) -> bool:
    return path.suffix.lower() == ".svg"


def get_safe_browse_path(relative_path: str) -> Path:
    """Safely resolve a path within the browse root for folder selection."""
    clean_path = Path(relative_path).as_posix().lstrip("/")
    if clean_path:
        full_path = (BROWSE_ROOT / clean_path).resolve()
    else:
        full_path = BROWSE_ROOT.resolve()

    # Ensure the path is within BROWSE_ROOT
    try:
        full_path.relative_to(BROWSE_ROOT.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: path outside browse root")

    return full_path


def get_safe_gallery_path(relative_path: str, gallery_root: str) -> Path:
    """Safely resolve a path within a selected gallery root."""
    if not gallery_root:
        raise HTTPException(status_code=400, detail="No gallery selected. Please select a folder first.")

    # Gallery root is relative to BROWSE_ROOT
    gallery_base = get_safe_browse_path(gallery_root)

    clean_path = Path(relative_path).as_posix().lstrip("/")
    if clean_path:
        full_path = (gallery_base / clean_path).resolve()
    else:
        full_path = gallery_base.resolve()

    # Ensure the path is within the gallery root
    try:
        full_path.relative_to(gallery_base.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: path outside gallery root")

    return full_path, gallery_base


@app.get("/api/browse")
async def browse_filesystem(path: str = "") -> list[BrowseItem]:
    """Browse the filesystem to select a gallery folder."""
    folder_path = get_safe_browse_path(path)

    if not folder_path.exists():
        raise HTTPException(status_code=404, detail="Folder not found")

    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a folder")

    items = []
    try:
        for item in sorted(folder_path.iterdir()):
            if item.name.startswith("."):
                continue

            if item.is_dir():
                # Check if folder contains images
                has_images = False
                try:
                    for subitem in item.iterdir():
                        if subitem.is_file() and is_image_file(subitem):
                            has_images = True
                            break
                except PermissionError:
                    pass

                rel_path = item.relative_to(BROWSE_ROOT).as_posix()
                items.append(BrowseItem(
                    name=item.name,
                    path=rel_path,
                    is_dir=True,
                    has_images=has_images
                ))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return items


@app.get("/api/browse-info")
async def get_browse_info(path: str = ""):
    """Get breadcrumb info for the browse dialog."""
    parts = [p for p in path.split("/") if p]
    breadcrumbs = [{"name": "Home", "path": ""}]

    current_path = ""
    for part in parts:
        current_path = f"{current_path}/{part}" if current_path else part
        breadcrumbs.append({"name": part, "path": current_path})

    return {"breadcrumbs": breadcrumbs, "current_path": path}


@app.get("/api/folders")
async def list_folders(path: str = "", gallery_root: str = Header(default="", alias="X-Gallery-Root")) -> list[FolderInfo]:
    """List folders at the given path within the selected gallery."""
    folder_path, gallery_base = get_safe_gallery_path(path, gallery_root)

    if not folder_path.exists():
        raise HTTPException(status_code=404, detail="Folder not found")

    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a folder")

    folders = []
    try:
        for item in sorted(folder_path.iterdir()):
            if item.is_dir() and not item.name.startswith("."):
                # Check if folder has images or subfolders
                has_images = False
                has_subfolders = False
                thumbnail = None

                try:
                    for subitem in item.iterdir():
                        if subitem.is_dir() and not subitem.name.startswith("."):
                            has_subfolders = True
                        elif subitem.is_file() and is_image_file(subitem):
                            has_images = True
                            if thumbnail is None:
                                # Use first image as thumbnail
                                rel_path = subitem.relative_to(gallery_base)
                                thumbnail = f"/api/image/{rel_path.as_posix()}"

                        if has_images and has_subfolders:
                            break
                except PermissionError:
                    pass

                rel_path = item.relative_to(gallery_base).as_posix()
                folders.append(FolderInfo(
                    name=item.name,
                    path=rel_path,
                    has_images=has_images,
                    has_subfolders=has_subfolders,
                    thumbnail=thumbnail
                ))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return folders


@app.get("/api/images")
async def list_images(path: str = "", gallery_root: str = Header(default="", alias="X-Gallery-Root")) -> list[ImageInfo]:
    """List images in the given folder within the selected gallery."""
    folder_path, gallery_base = get_safe_gallery_path(path, gallery_root)

    if not folder_path.exists():
        raise HTTPException(status_code=404, detail="Folder not found")

    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a folder")

    images = []
    try:
        for item in sorted(folder_path.iterdir()):
            if item.is_file() and is_image_file(item):
                rel_path = item.relative_to(gallery_base).as_posix()
                images.append(ImageInfo(
                    name=item.name,
                    path=rel_path,
                    size=item.stat().st_size,
                    is_raw=is_raw_file(item)
                ))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return images


@app.get("/api/image/{path:path}")
async def get_image(
    path: str,
    thumbnail: bool = False,
    width: Optional[int] = None,
    height: Optional[int] = None,
    gallery_root: str = Query(default="", alias="gallery_root")
):
    """Get an image file, optionally resized or as thumbnail."""
    file_path, gallery_base = get_safe_gallery_path(path, gallery_root)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    if not file_path.is_file() or not is_image_file(file_path):
        raise HTTPException(status_code=400, detail="Not an image file")

    # SVG files can't be processed by PIL - always serve directly
    if is_svg_file(file_path):
        return FileResponse(file_path, media_type="image/svg+xml")

    processor = ImageProcessor()

    # Handle RAW files - always convert
    if is_raw_file(file_path):
        image_data, content_type = processor.process_raw(file_path, thumbnail=thumbnail, width=width, height=height)
        return Response(content=image_data, media_type=content_type)

    # For regular images, serve directly if no processing needed
    if not thumbnail and width is None and height is None:
        content_type, _ = mimetypes.guess_type(str(file_path))
        return FileResponse(file_path, media_type=content_type or "application/octet-stream")

    # Process the image (resize/thumbnail)
    image_data, content_type = processor.process_image(file_path, thumbnail=thumbnail, width=width, height=height)
    return Response(content=image_data, media_type=content_type)


@app.post("/api/edit")
async def edit_image(request: EditRequest):
    """
    Apply non-destructive edits to an image and save with prefix/suffix.
    The original image is never modified.
    """
    file_path, gallery_base = get_safe_gallery_path(request.path, request.gallery_root)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    if not file_path.is_file() or not is_image_file(file_path):
        raise HTTPException(status_code=400, detail="Not an image file")

    processor = ImageProcessor()

    try:
        output_path = processor.apply_edits(
            file_path,
            request.operations,
            output_prefix=request.output_prefix,
            output_suffix=request.output_suffix
        )

        rel_path = output_path.relative_to(gallery_base).as_posix()
        return {"success": True, "output_path": rel_path}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process image: {str(e)}")


@app.get("/api/path-info")
async def get_path_info(path: str = ""):
    """Get information about a path for breadcrumb navigation."""
    parts = [p for p in path.split("/") if p]
    breadcrumbs = [{"name": "Home", "path": ""}]

    current_path = ""
    for part in parts:
        current_path = f"{current_path}/{part}" if current_path else part
        breadcrumbs.append({"name": part, "path": current_path})

    return {"breadcrumbs": breadcrumbs, "current": parts[-1] if parts else "Home"}


@app.post("/api/edit-upload")
async def edit_upload(
    image: UploadFile = File(...),
    path: str = Form(...),
    output_prefix: str = Form(""),
    output_suffix: str = Form("_edited"),
    gallery_root: str = Form("")
):
    """
    Upload an edited image from the client-side canvas.
    The original image is never modified - a new file is created.
    """
    file_path, gallery_base = get_safe_gallery_path(path, gallery_root)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Original image not found")

    # Determine output filename
    original_name = file_path.stem
    original_ext = file_path.suffix

    # Use PNG extension since canvas outputs PNG
    output_name = f"{output_prefix}{original_name}{output_suffix}.png"
    output_path = file_path.parent / output_name

    # Ensure output path is still within gallery
    try:
        output_path.resolve().relative_to(gallery_base.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Output path outside gallery")

    # Check for conflicts
    counter = 1
    while output_path.exists():
        output_name = f"{output_prefix}{original_name}{output_suffix}_{counter}.png"
        output_path = file_path.parent / output_name
        counter += 1

    try:
        # Save the uploaded image
        content = await image.read()
        with open(output_path, 'wb') as f:
            f.write(content)

        rel_path = output_path.relative_to(gallery_base).as_posix()
        return {"success": True, "output_path": rel_path}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save image: {str(e)}")


@app.get("/api/file-info")
async def get_file_info(path: str, gallery_root: str = Query(default="", alias="gallery_root")):
    """Get detailed information about an image file including its real path."""
    file_path, gallery_base = get_safe_gallery_path(path, gallery_root)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    stat = file_path.stat()

    return {
        "name": file_path.name,
        "path": path,
        "real_path": str(file_path),  # Full filesystem path for opening in file manager
        "size": stat.st_size,
        "size_human": format_size(stat.st_size),
        "modified": stat.st_mtime
    }


@app.delete("/api/delete")
async def delete_image(path: str, gallery_root: str = Query(default="", alias="gallery_root")):
    """Delete an image file. This action cannot be undone."""
    file_path, gallery_base = get_safe_gallery_path(path, gallery_root)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    if not is_image_file(file_path):
        raise HTTPException(status_code=400, detail="Not an image file")

    try:
        file_path.unlink()
        return {"success": True, "deleted": path}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied - cannot delete file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")


def format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# Serve frontend static files
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
