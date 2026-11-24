"""Package the Codex skill with the same website source used by the demo."""

from argparse import ArgumentParser
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parent.parent
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=root / "dist" / "resume-portfolio-skill.zip",
        help="Path for the installable ZIP",
    )
    output = parser.parse_args().output
    output.parent.mkdir(parents=True, exist_ok=True)

    site = root / "docs"
    skill = root / "skill"
    site_files = sorted(
        path for path in site.rglob("*")
        if path.is_file()
        and path.relative_to(site).parts[0] != "showcase"
        and not any(part.startswith(".") for part in path.relative_to(site).parts)
    )

    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        archive.write(root / "LICENSE", "resume-portfolio/LICENSE")
        for name in ("SKILL.md", "README.md", "agents/openai.yaml"):
            archive.write(skill / name, f"resume-portfolio/{name}")
        for path in site_files:
            archive.write(path, f"resume-portfolio/assets/site/{path.relative_to(site).as_posix()}")
    print(output)


if __name__ == "__main__":
    main()
