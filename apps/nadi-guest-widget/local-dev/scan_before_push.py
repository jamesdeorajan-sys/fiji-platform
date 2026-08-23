import re, os, json

ROOT = os.path.dirname(__file__)
EXCLUDE_DIRS = {"local-dev"}  # scanned separately below with its own allowance for the mock's placeholder token
SKIP_EXT = {".png", ".jpg", ".jpeg", ".webp", ".ico"}

PATTERNS = {
    "api_key_shape": re.compile(r"(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9a-zA-Z-]{10,}|SG\.[a-zA-Z0-9_-]{20,})"),
    "jwt_shape": re.compile(r"eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}"),
    "password_or_secret_assign": re.compile(r"(password|passwd|api[_-]?key)\s*[:=]\s*[\"'][^\"']{6,}[\"']", re.I),
    "email": re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b"),
    "phone_strict": re.compile(r"(?<![\d/])\+?61[\s.-]?\d{1,3}[\s.-]?\d{3}[\s.-]?\d{3}(?![\d/])"),
    "bearer_token": re.compile(r"Bearer\s+[a-zA-Z0-9_\-\.]{15,}"),
}

findings = {}
for dirpath, dirnames, files in os.walk(ROOT):
    rel_dir = os.path.relpath(dirpath, ROOT)
    top = rel_dir.split(os.sep)[0]
    for fname in files:
        if fname == "scan_before_push.py":
            continue
        ext = os.path.splitext(fname)[1].lower()
        if ext in SKIP_EXT:
            continue
        path = os.path.join(dirpath, fname)
        rel = os.path.relpath(path, ROOT)
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except Exception as e:
            findings[rel] = f"READ_ERROR: {e}"
            continue
        hits = {}
        for name, pat in PATTERNS.items():
            m = pat.findall(text)
            if m:
                hits[name] = list(set(m))[:6]
        if hits:
            findings[rel] = hits

print(json.dumps(findings, indent=2, default=str))
print()
print(f"{len(findings)} file(s) with matches, out of full tree scan.")
