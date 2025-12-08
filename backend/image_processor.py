"""
Image processing module for Echo Image Viewer.
Handles image manipulation, RAW conversion, and non-destructive editing.
"""

import io
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

# Try to import rawpy for RAW file support
try:
    import rawpy
    HAS_RAWPY = True
except ImportError:
    HAS_RAWPY = False


class ImageProcessor:
    """Handles image processing operations."""

    THUMBNAIL_SIZE = (300, 300)
    OUTPUT_FORMAT = "JPEG"
    OUTPUT_QUALITY = 90

    def process_raw(
        self,
        file_path: Path,
        thumbnail: bool = False,
        width: Optional[int] = None,
        height: Optional[int] = None
    ) -> tuple[bytes, str]:
        """
        Convert a RAW file to a viewable format.
        Returns (image_bytes, content_type).
        """
        if not HAS_RAWPY:
            raise ValueError("RAW file support not available (rawpy not installed)")

        with rawpy.imread(str(file_path)) as raw:
            # Use half_size for thumbnails for faster processing
            if thumbnail:
                rgb = raw.postprocess(half_size=True, use_camera_wb=True)
            else:
                rgb = raw.postprocess(use_camera_wb=True)

        image = Image.fromarray(rgb)

        # Apply resizing if requested
        if thumbnail:
            image.thumbnail(self.THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
        elif width or height:
            image = self._resize_image(image, width, height)

        # Convert to bytes
        buffer = io.BytesIO()
        image.save(buffer, format=self.OUTPUT_FORMAT, quality=self.OUTPUT_QUALITY)
        return buffer.getvalue(), "image/jpeg"

    def process_image(
        self,
        file_path: Path,
        thumbnail: bool = False,
        width: Optional[int] = None,
        height: Optional[int] = None
    ) -> tuple[bytes, str]:
        """
        Process a standard image file.
        Returns (image_bytes, content_type).
        """
        image = Image.open(file_path)

        # Handle EXIF orientation
        image = ImageOps.exif_transpose(image)

        # Convert to RGB if necessary (for JPEG output)
        if image.mode in ("RGBA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1])
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Apply resizing
        if thumbnail:
            image.thumbnail(self.THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
        elif width or height:
            image = self._resize_image(image, width, height)

        # Convert to bytes
        buffer = io.BytesIO()
        image.save(buffer, format=self.OUTPUT_FORMAT, quality=self.OUTPUT_QUALITY)
        return buffer.getvalue(), "image/jpeg"

    def _resize_image(
        self,
        image: Image.Image,
        width: Optional[int],
        height: Optional[int]
    ) -> Image.Image:
        """Resize image maintaining aspect ratio."""
        orig_width, orig_height = image.size

        if width and height:
            # Fit within box
            image.thumbnail((width, height), Image.Resampling.LANCZOS)
        elif width:
            # Scale by width
            ratio = width / orig_width
            new_height = int(orig_height * ratio)
            image = image.resize((width, new_height), Image.Resampling.LANCZOS)
        elif height:
            # Scale by height
            ratio = height / orig_height
            new_width = int(orig_width * ratio)
            image = image.resize((new_width, height), Image.Resampling.LANCZOS)

        return image

    def apply_edits(
        self,
        file_path: Path,
        operations: list[dict],
        output_prefix: str = "",
        output_suffix: str = "_edited"
    ) -> Path:
        """
        Apply a series of edit operations and save to a new file.
        Never modifies the original.

        Supported operations:
        - {"type": "rotate", "angle": 90}  (90, 180, 270, or any angle)
        - {"type": "crop", "x": 0, "y": 0, "width": 100, "height": 100}
        - {"type": "resize", "width": 800, "height": 600}  (maintains aspect if only one dimension)
        - {"type": "flip", "direction": "horizontal"}  (horizontal or vertical)
        """
        # Load image (handle RAW files)
        if file_path.suffix.lower() in {".raw", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw"}:
            if not HAS_RAWPY:
                raise ValueError("RAW file support not available")
            with rawpy.imread(str(file_path)) as raw:
                rgb = raw.postprocess(use_camera_wb=True)
            image = Image.fromarray(rgb)
        else:
            image = Image.open(file_path)
            image = ImageOps.exif_transpose(image)

        # Convert to RGB for processing
        if image.mode in ("RGBA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1])
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Apply operations in order
        for op in operations:
            op_type = op.get("type")

            if op_type == "rotate":
                angle = op.get("angle", 0)
                # PIL rotates counter-clockwise, so negate for clockwise
                image = image.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

            elif op_type == "crop":
                x = op.get("x", 0)
                y = op.get("y", 0)
                width = op.get("width", image.width - x)
                height = op.get("height", image.height - y)

                # Validate crop bounds
                if x < 0 or y < 0 or width <= 0 or height <= 0:
                    raise ValueError("Invalid crop dimensions")
                if x + width > image.width or y + height > image.height:
                    raise ValueError("Crop extends beyond image bounds")

                image = image.crop((x, y, x + width, y + height))

            elif op_type == "resize":
                width = op.get("width")
                height = op.get("height")

                if width and height:
                    image = image.resize((width, height), Image.Resampling.LANCZOS)
                elif width:
                    ratio = width / image.width
                    new_height = int(image.height * ratio)
                    image = image.resize((width, new_height), Image.Resampling.LANCZOS)
                elif height:
                    ratio = height / image.height
                    new_width = int(image.width * ratio)
                    image = image.resize((new_width, height), Image.Resampling.LANCZOS)

            elif op_type == "flip":
                direction = op.get("direction", "horizontal")
                if direction == "horizontal":
                    image = ImageOps.mirror(image)
                elif direction == "vertical":
                    image = ImageOps.flip(image)
                else:
                    raise ValueError(f"Unknown flip direction: {direction}")

            else:
                raise ValueError(f"Unknown operation type: {op_type}")

        # Generate output filename
        stem = file_path.stem
        output_name = f"{output_prefix}{stem}{output_suffix}.jpg"
        output_path = file_path.parent / output_name

        # Ensure we don't overwrite existing files
        counter = 1
        while output_path.exists():
            output_name = f"{output_prefix}{stem}{output_suffix}_{counter}.jpg"
            output_path = file_path.parent / output_name
            counter += 1

        # Save the edited image
        image.save(output_path, format="JPEG", quality=self.OUTPUT_QUALITY)

        return output_path
