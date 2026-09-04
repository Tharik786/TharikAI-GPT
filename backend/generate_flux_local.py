"""
Local Hugging Face FLUX.1 Diffusion Pipeline Runner
Generates ultra-high quality AI images using black-forest-labs/FLUX.1-dev or FLUX.1-schnell.
"""

import os
import torch
from pathlib import Path
from dotenv import load_dotenv

# Load environment
load_dotenv()

def generate_flux_image(
    prompt: str = "Astronaut in a jungle, cold color palette, muted colors, detailed, 8k",
    output_path: str = "flux_output.png",
    model_id: str = "black-forest-labs/FLUX.1-dev",  # or "black-forest-labs/FLUX.1-schnell"
    num_inference_steps: int = 28,
    guidance_scale: float = 3.5,
    width: int = 1024,
    height: int = 1024,
):
    try:
        from diffusers import DiffusionPipeline
    except ImportError:
        raise ImportError(
            "Please install diffusers, transformers, and accelerate:\n"
            "pip install -U diffusers transformers accelerate"
        )

    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    print(f"🚀 Loading {model_id} on {device} (dtype={dtype})...")

    # Load FLUX.1 pipeline
    if device == "cuda":
        pipe = DiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=dtype,
            device_map="balanced",
        )
        # Enable memory optimizations for consumer GPUs
        try:
            pipe.enable_model_cpu_offload()
            pipe.enable_sequential_cpu_offload()
        except Exception:
            pass
    else:
        pipe = DiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=dtype,
        ).to(device)

    print(f"🎨 Generating image for prompt: '{prompt}'...")
    image = pipe(
        prompt=prompt,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        width=width,
        height=height,
    ).images[0]

    image.save(output_path)
    print(f"✅ Image successfully saved to: {output_path}")
    return image


if __name__ == "__main__":
    import sys
    test_prompt = sys.argv[1] if len(sys.argv) > 1 else "Astronaut in a jungle, cold color palette, muted colors, detailed, 8k"
    generate_flux_image(prompt=test_prompt)
