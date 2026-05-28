def normalize_name(name: str) -> str:
    # Intentional demo bug for Phase 2: this should title-case human names.
    return name.strip()


def greet(name: str) -> str:
    return f"Hello, {normalize_name(name)}!"


if __name__ == "__main__":
    print(greet("codex_lead_cc"))
