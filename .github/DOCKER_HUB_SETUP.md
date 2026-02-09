# Docker Hub Setup Guide (For Future Use)

This guide explains how to add Docker Hub publishing when you're ready.

## Prerequisites

- Docker Hub account
- Access to repository settings

## Step 1: Create Docker Hub Access Token

1. Log in to [Docker Hub](https://hub.docker.com)
2. Go to Account Settings → Security
3. Click "New Access Token"
4. Description: "GitHub Actions - AIOS"
5. Permissions: Read & Write
6. Click "Generate" and **copy the token immediately**

## Step 2: Add GitHub Secrets

1. Go to: https://github.com/IbbyLabs/AIOS/settings/secrets/actions
2. Add two secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username
   - `DOCKERHUB_TOKEN`: The access token from Step 1

## Step 3: Update Workflows

Edit `.github/workflows/deploy-docker.yml`:

1. Add Docker Hub login step after the GHCR login step:
```yaml
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
```

2. Update the "Calculate Image Tags" step to include Docker Hub:
```yaml
          {
            echo 'DOCKER_IMAGE_TAGS<<EOF'
            for tag in ${TAGS}; do
            echo "${{ github.repository_owner }}/aios:${tag}"
            echo "ghcr.io/${{ github.repository_owner }}/aios:${tag}"
            done
            echo EOF
          } >> "${GITHUB_ENV}"
```

3. Update Discord notification to include both registries:
```yaml
                  {
                    "name": "📍 View Images",
                    "value": "[Docker Hub](https://hub.docker.com/r/${{ github.repository_owner }}/aios) · [GHCR](https://github.com/${{ github.repository }}/pkgs/container/aios)",
                    "inline": false
                  },
```

## Step 4: Test the Workflow

1. Create a test tag or trigger the workflow manually
2. Verify images are pushed to both Docker Hub and GHCR
3. Check Discord notification includes both registry links

## Notes

- The workflow will fail if Docker Hub credentials are not configured
- Images will always be pushed to GHCR even if Docker Hub fails
- Make sure to test in a fork or development branch first
