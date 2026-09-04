"""
Local Hugging Face Transformers Inference Runner for SHSLab/Kimi-K3-Abliterated
Supports real-time token streaming with TextIteratorStreamer, GPU device_map='auto', and 4-bit / 8-bit quantization.
"""

import os
import sys
import threading
import torch
from dotenv import load_dotenv

load_dotenv()

MODEL_ID = "SHSLab/Kimi-K3-Abliterated"

def load_kimi_model(model_id: str = MODEL_ID, use_4bit: bool = False):
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    except ImportError:
        raise ImportError(
            "Please install transformers and accelerate:\n"
            "pip install -U transformers accelerate torch"
        )

    print(f"🚀 Loading {model_id} (trust_remote_code=True)...")
    
    tokenizer = AutoTokenizer.from_pretrained(
        model_id,
        trust_remote_code=True,
    )

    device_map = "auto" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    load_kwargs = {
        "trust_remote_code": True,
        "torch_dtype": torch_dtype,
        "device_map": device_map,
    }

    if use_4bit and torch.cuda.is_available():
        try:
            from transformers import BitsAndBytesConfig
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
            )
            print("⚡ 4-bit quantization enabled via BitsAndBytes.")
        except ImportError:
            print("⚠️ bitsandbytes not installed. Loading in standard bfloat16.")

    model = AutoModelForCausalLM.from_pretrained(model_id, **load_kwargs)
    print(f"✅ Model successfully loaded on {device_map}.")
    return model, tokenizer


def chat_stream(model, tokenizer, prompt: str, system_prompt: str = "You are TharikAI, a helpful and intelligent AI assistant."):
    from transformers import TextIteratorStreamer

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    # Format prompt using chat template if available, else standard formatting
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        formatted_input = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    else:
        formatted_input = f"<|im_start|>system\n{system_prompt}<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"

    inputs = tokenizer(formatted_input, return_tensors="pt").to(model.device)
    streamer = TextIteratorStreamer(tokenizer, timeout=60.0, skip_prompt=True, skip_special_tokens=True)

    generation_kwargs = dict(
        inputs,
        streamer=streamer,
        max_new_tokens=2048,
        temperature=0.7,
        top_p=0.9,
        do_sample=True,
    )

    thread = threading.Thread(target=model.generate, kwargs=generation_kwargs)
    thread.start()

    print("\n💬 Assistant: ", end="", flush=True)
    for new_text in streamer:
        print(new_text, end="", flush=True)
        yield new_text
    print("\n")


if __name__ == "__main__":
    prompt_arg = sys.argv[1] if len(sys.argv) > 1 else "Hello! Introduce yourself and what you can do."
    model, tokenizer = load_kimi_model()
    for _ in chat_stream(model, tokenizer, prompt_arg):
        pass
