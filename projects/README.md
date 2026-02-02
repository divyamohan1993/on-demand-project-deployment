# Projects Configuration Directory

This directory contains project configuration files. Each project is defined by a single `.json` file.

## Adding a New Project

1. Create a new file named `{project-id}.json` (e.g., `setu-voice-ondc.json`)
2. Follow the template below

## File Format

```json
{
    "name": "Project Display Name",
    "description": "Short description shown on the card",
    "github_url": "https://github.com/username/repo",
    "autoconfig_script": "autoconfig.sh",
    "port": 3000,
    "icon": "🚀",
    "category": "AI/ML",
    "env_vars": {
        "PORT": "3000",
        "NODE_ENV": "production"
    }
}
```

## Environment Variables

You can also create a separate `.env` file for secrets:

- Create `{project-id}.env` with sensitive variables
- These will be merged with `env_vars` from the JSON file
- The `.env` file variables take priority

## Example

**setu-voice-ondc.json:**
```json
{
    "name": "Setu Voice ONDC Gateway",
    "description": "AI-powered voice interface for ONDC marketplace",
    "github_url": "https://github.com/divyamohan1993/setu-voice-ondc-gateway",
    "autoconfig_script": "autoconfig.sh",
    "port": 3000,
    "icon": "🎤",
    "category": "AI/ML",
    "env_vars": {
        "PORT": "3000",
        "NODE_ENV": "production"
    }
}
```

**setu-voice-ondc.env:**
```
GOOGLE_AI_API_KEY=your_key_here
DATABASE_URL=file:./dev.db
```

## Notes

- Project ID = filename without extension
- Files prefixed with `_` or `.` are ignored
- Invalid JSON files are skipped with an error log
