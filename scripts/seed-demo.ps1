#requires -Version 7.0

param(
    [string]$ApiBaseUrl = "http://127.0.0.1:5080",
    [string]$WebBaseUrl = "http://127.0.0.1:5173",
    [string]$OwnerEmail = "demo@cytask.local",
    [string]$Password = "cytask-demo-local-2026!"
)

$ErrorActionPreference = "Stop"

$ownerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Invoke-DemoApi {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [object]$Body,
        [hashtable]$Headers,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session = $ownerSession
    )

    $request = @{
        Uri = "$ApiBaseUrl$Path"
        Method = $Method
        WebSession = $Session
    }
    if ($null -ne $Headers) {
        $request.Headers = $Headers
    }
    if ($null -ne $Body) {
        $request.ContentType = "application/json"
        $request.Body = $Body | ConvertTo-Json -Depth 12 -Compress
    }

    Invoke-RestMethod @request
}

$bootstrapStatus = Invoke-DemoApi -Method Get -Path "/api/v1/bootstrap/status"
if ($bootstrapStatus.required) {
    $authentication = Invoke-DemoApi -Method Post -Path "/api/v1/bootstrap" -Body @{
        email = $OwnerEmail
        displayName = "Morgan Lefèvre"
        password = $Password
        organizationName = "Northstar Studio"
    }
}
else {
    $authentication = Invoke-DemoApi -Method Post -Path "/api/v1/sessions" -Body @{
        email = $OwnerEmail
        password = $Password
    }
}

$csrfHeaders = @{ "X-CSRF-Token" = $authentication.csrfToken }
$members = Invoke-DemoApi -Method Get -Path "/api/v1/members"
$demoPeople = @(
    @{ Email = "alice@cytask.local"; DisplayName = "Alice Moreau"; Role = "member" },
    @{ Email = "noah@cytask.local"; DisplayName = "Noah Bernard"; Role = "member" },
    @{ Email = "chloe@cytask.local"; DisplayName = "Chloé Martin"; Role = "member" }
)

foreach ($person in $demoPeople) {
    if ($members.email -contains $person.Email) {
        continue
    }

    $invitation = Invoke-DemoApi -Method Post -Path "/api/v1/invitations" -Headers $csrfHeaders -Body @{
        email = $person.Email
        role = $person.Role
    }
    $memberSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Invoke-DemoApi -Method Post -Path "/api/v1/invitations/accept" -Session $memberSession -Body @{
        token = $invitation.token
        displayName = $person.DisplayName
        password = $Password
    } | Out-Null
}

$members = Invoke-DemoApi -Method Get -Path "/api/v1/members"
$memberIds = @{}
foreach ($member in $members) {
    $memberIds[$member.email] = $member.userId
}

function Add-PerformanceTasks {
    param(
        [Parameter(Mandatory = $true)][object]$Project,
        [Parameter(Mandatory = $true)][int]$ExistingCount,
        [Parameter(Mandatory = $true)][hashtable]$LabelIds
    )

    $targetTaskCount = 220
    if ($ExistingCount -ge $targetTaskCount) {
        return 0
    }

    $catalogs = @(
        @{ Prefix = "[ART]"; Label = "Environment"; Titles = @("Kit modulaire de maintenance", "Passe matériaux du hangar", "Déclinaison des props de coursive", "Optimisation des LOD de décor") },
        @{ Prefix = "[GAMEPLAY]"; Label = "Interactions"; Titles = @("Interaction du sas secondaire", "Réglage de la gravité locale", "Feedback du terminal de contrôle", "Parcours joueur de la baie orbitale") },
        @{ Prefix = "[AUDIO]"; Label = "Audio"; Titles = @("Ambiance de ventilation", "Variation de l’alarme de secteur", "Mix du terminal diégétique", "Occlusion des coursives techniques") },
        @{ Prefix = "[BUILD]"; Label = "QA & Validation"; Titles = @("Validation de la build Windows", "Analyse du rapport de crash", "Préparation du paquet de revue", "Contrôle des symboles de diagnostic") },
        @{ Prefix = "[QA]"; Label = "NPC Physics"; Titles = @("Vérification des collisions", "Test de régression multijoueur", "Contrôle du navmesh du hangar", "Reproduction du défaut d’interaction") },
        @{ Prefix = "[R&D]"; Label = "R&D"; Titles = @("Prototype Niagara volumétrique", "Mesure du budget GPU", "Essai de streaming des assets", "Comparatif du pipeline de conversion") }
    )
    $assigneePool = @($memberIds.Values)
    $generatedAt = [DateTimeOffset]::UtcNow
    $added = 0

    for ($index = $ExistingCount + 1; $index -le $targetTaskCount; $index += 1) {
        $catalog = $catalogs[($index - 1) % $catalogs.Count]
        $titleVariant = $catalog.Titles[([Math]::Floor(($index - 1) / $catalogs.Count)) % $catalog.Titles.Count]
        $sequence = "{0:D3}" -f $index
        $status = if ($index % 29 -eq 0) {
            "cancelled"
        }
        elseif ($index % 11 -eq 0) {
            "done"
        }
        elseif ($index % 7 -eq 0) {
            "blocked"
        }
        elseif ($index % 3 -eq 0) {
            "in_progress"
        }
        else {
            "todo"
        }
        $priority = if ($index % 13 -eq 0) {
            "urgent"
        }
        elseif ($index % 5 -eq 0) {
            "high"
        }
        elseif ($index % 4 -eq 0) {
            "low"
        }
        else {
            "normal"
        }
        $dueAt = if ($index % 17 -eq 0) {
            $null
        }
        else {
            $generatedAt.AddDays(($index % 35) - 7).ToString("o")
        }
        $assigneeIds = @(
            if ($index % 13 -eq 0 -or $assigneePool.Count -eq 0) {
            }
            elseif ($index % 9 -eq 0 -and $assigneePool.Count -gt 1) {
                $assigneePool[($index - 1) % $assigneePool.Count]
                $assigneePool[$index % $assigneePool.Count]
            }
            else {
                $assigneePool[($index - 1) % $assigneePool.Count]
            }
        )

        $createdTask = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/tasks" -Headers $csrfHeaders -Body @{
            title = "$($catalog.Prefix) $titleVariant · lot $sequence"
            description = "Tâche de démonstration $sequence pour tester la navigation, les filtres, la pagination et la charge d’un projet de production réaliste."
            priority = $priority
            dueAt = $dueAt
            assigneeIds = $assigneeIds
        }

        if ($status -ne "todo") {
            $createdTask = Invoke-DemoApi -Method Patch -Path "/api/v1/tasks/$($createdTask.id)" -Headers $csrfHeaders -Body @{
                title = $createdTask.title
                description = $createdTask.description
                status = $status
                priority = $createdTask.priority
                dueAt = $createdTask.dueAt
                assigneeIds = $assigneeIds
                expectedRevision = $createdTask.revision
            }
        }

        if ($LabelIds.ContainsKey($catalog.Label)) {
            Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$($createdTask.id)/labels/$($LabelIds[$catalog.Label])" -Headers $csrfHeaders | Out-Null
        }
        if ($priority -eq "urgent" -and $LabelIds.ContainsKey("Urgent")) {
            Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$($createdTask.id)/labels/$($LabelIds["Urgent"])" -Headers $csrfHeaders | Out-Null
        }

        $added += 1
        if ($added % 25 -eq 0) {
            Write-Progress -Activity "Création du projet de charge CyTask" -Status "$($ExistingCount + $added) / $targetTaskCount tâches" -PercentComplete ((($ExistingCount + $added) / $targetTaskCount) * 100)
        }
    }

    Write-Progress -Activity "Création du projet de charge CyTask" -Completed
    return $added
}

function Set-DemoWorkflowExamples {
    param(
        [Parameter(Mandatory = $true)][object]$Project
    )

    $statusDefinitions = @(
        @{ Name = "En validation"; Color = "#8B5CF6" },
        @{ Name = "Prête à livrer"; Color = "#06B6D4" }
    )
    $statusKeys = @{}
    $statuses = @(Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($Project.id)/statuses" | ForEach-Object { $_ })
    foreach ($definition in $statusDefinitions) {
        $status = $statuses | Where-Object { $_.name -eq $definition.Name } | Select-Object -First 1
        if ($null -eq $status) {
            $status = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/statuses" -Headers $csrfHeaders -Body @{
                name = $definition.Name
                color = $definition.Color
            }
            $statuses += $status
        }
        elseif ($status.color -ne $definition.Color) {
            $status = Invoke-DemoApi -Method Patch -Path "/api/v1/projects/$($Project.id)/statuses/$($status.key)" -Headers $csrfHeaders -Body @{
                name = $definition.Name
                color = $definition.Color
            }
        }
        $statusKeys[$definition.Name] = $status.key
    }

    $taskOptions = @(Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($Project.id)/task-options" | ForEach-Object { $_ })
    $assigneePool = @($memberIds.Values | Sort-Object)
    if ($taskOptions.Count -eq 0 -or $assigneePool.Count -lt 2) {
        return $statusKeys
    }

    $examples = @(
        @{ TaskIndex = 2; StatusName = "En validation"; AssigneeOffsets = @(0, 1) },
        @{ TaskIndex = 7; StatusName = "Prête à livrer"; AssigneeOffsets = @(1, 2) }
    )
    foreach ($example in $examples) {
        if ($example.TaskIndex -ge $taskOptions.Count) {
            continue
        }

        $taskDetails = Invoke-DemoApi -Method Get -Path "/api/v1/tasks/$($taskOptions[$example.TaskIndex].id)"
        $task = $taskDetails.task
        $targetAssigneeIds = @(
            $example.AssigneeOffsets |
                ForEach-Object { $assigneePool[$_ % $assigneePool.Count] } |
                Sort-Object -Unique
        )
        $currentAssigneeIds = if ($null -ne $task.assignees) {
            @($task.assignees | ForEach-Object { $_.userId } | Sort-Object -Unique)
        }
        elseif ($null -ne $task.assigneeId) {
            @($task.assigneeId)
        }
        else {
            @()
        }
        $assigneesMatch = (@($currentAssigneeIds) -join ",") -eq (@($targetAssigneeIds) -join ",")
        $targetStatus = $statusKeys[$example.StatusName]
        if ($task.status -eq $targetStatus -and $assigneesMatch) {
            continue
        }

        $updated = Invoke-DemoApi -Method Patch -Path "/api/v1/tasks/$($task.id)" -Headers $csrfHeaders -Body @{
            title = $task.title
            description = $task.description
            status = $targetStatus
            priority = $task.priority
            dueAt = $task.dueAt
            assigneeIds = $targetAssigneeIds
            expectedRevision = $task.revision
        }
    }

    return $statusKeys
}

function Add-DemoSubfolders {
    param(
        [Parameter(Mandatory = $true)][object]$Project,
        [Parameter(Mandatory = $true)][hashtable]$LabelIds
    )

    $definitions = @(
        @{ Name = "Environment"; Parent = "Art"; Color = "#C026D3" },
        @{ Name = "NPC Physics"; Parent = "Gameplay"; Color = "#F97316" },
        @{ Name = "Interactions"; Parent = "Gameplay"; Color = "#2563EB" },
        @{ Name = "QA & Validation"; Parent = "Build"; Color = "#16A34A" }
    )

    foreach ($definition in $definitions) {
        if ($LabelIds.ContainsKey($definition.Name) -or !$LabelIds.ContainsKey($definition.Parent)) {
            continue
        }

        $folder = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/labels" -Headers $csrfHeaders -Body @{
            name = $definition.Name
            color = $definition.Color
            parentLabelId = $LabelIds[$definition.Parent]
        }
        $LabelIds[$definition.Name] = $folder.id
    }
}

function Add-DemoMediaPreview {
    param([Parameter(Mandatory = $true)][string]$TaskId)

    $existing = @(Invoke-DemoApi -Method Get -Path "/api/v1/tasks/$TaskId/attachments")
    if ($existing | Where-Object { $_.fileName -eq "canvas-preview.png" }) {
        return
    }

    $bytes = [Convert]::FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
    $sha256 = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    $upload = Invoke-DemoApi -Method Post -Path "/api/v1/tasks/$TaskId/attachment-uploads" -Headers $csrfHeaders -Body @{
        fileName = "canvas-preview.png"
        contentType = "image/png"
        sizeBytes = $bytes.Length
        sha256 = $sha256
        optimizedLocally = $false
    }
    $chunkRequest = @{
        Uri = "$ApiBaseUrl/api/v1/attachment-uploads/$($upload.id)/chunks/0"
        Method = "Put"
        ContentType = "application/octet-stream"
        Body = $bytes
        Headers = @{
            "X-CSRF-Token" = $authentication.csrfToken
            "X-Chunk-SHA256" = $sha256
        }
        WebSession = $ownerSession
    }
    Invoke-RestMethod @chunkRequest | Out-Null
    Invoke-DemoApi -Method Post -Path "/api/v1/attachment-uploads/$($upload.id)/complete" -Headers $csrfHeaders | Out-Null
}

function Add-DemoCollaborationContent {
    param(
        [Parameter(Mandatory = $true)][object]$Project,
        [Parameter(Mandatory = $true)][hashtable]$LabelIds
    )

    $resourceDefinitions = @(
        @{
            Type = "document"; Name = "Brief — Vertical Slice"; Folder = $null
            Body = "# Nebula Station — Vertical Slice`n`n## Objectif`nLivrer une expérience jouable de quinze minutes dans le hangar orbital.`n`n## Critères de revue`n- Gameplay lisible`n- Direction artistique cohérente`n- Build Windows reproductible`n- Budget GPU respecté"
        },
        @{
            Type = "document"; Name = "Guide d’intégration des assets"; Folder = "Art"
            Body = "# Guide d’intégration`n`n## Nommage`nUtiliser le préfixe NEB_ et préciser le type d’asset.`n`n## Validation`n1. UV et texel density`n2. Collisions`n3. LOD`n4. Capture dans la tâche liée"
        },
        @{
            Type = "document"; Name = "Plan de validation QA"; Folder = "QA & Validation"
            Body = "# Plan QA`n`n- Smoke test à chaque build`n- Parcours complet du hangar`n- Vérification des interactions`n- Rapport de performances`n- Revue des régressions bloquantes"
        },
        @{
            Type = "canvas"; Name = "Moodboard du hangar"; Folder = "Environment"
            Body = '{"version":1,"objects":[{"id":"demo-title","kind":"text","x":130,"y":100,"width":350,"height":150,"color":"#7CF2C4","text":"Moodboard — Hangar orbital"},{"id":"demo-note","kind":"text","x":540,"y":280,"width":320,"height":180,"color":"#F2C27C","text":"Contraste froid / balises chaudes\nLisibilité des circulations\nMatériaux industriels"}],"strokes":[]}'
        },
        @{
            Type = "canvas"; Name = "Flux de la revue hebdomadaire"; Folder = "Build"
            Body = '{"version":1,"objects":[{"id":"review-a","kind":"rectangle","x":130,"y":160,"width":240,"height":130,"color":"#8FB7FF","text":"Collecte"},{"id":"review-b","kind":"rectangle","x":500,"y":160,"width":240,"height":130,"color":"#7CF2C4","text":"Revue"},{"id":"review-c","kind":"rectangle","x":870,"y":160,"width":240,"height":130,"color":"#F2C27C","text":"Décision"}],"strokes":[]}'
        }
    )

    $resourceResponse = Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($Project.id)/resources"
    $resources = @($resourceResponse)
    $resourcesByName = @{}
    foreach ($resource in $resources) {
        if ($null -eq $resource -or [string]::IsNullOrWhiteSpace([string]$resource.name)) { continue }
        $resourcesByName[$resource.name] = $resource
    }
    foreach ($definition in $resourceDefinitions) {
        if ($resourcesByName.ContainsKey($definition.Name)) {
            continue
        }
        $folderLabelId = $null
        if ($null -ne $definition.Folder -and $LabelIds.ContainsKey($definition.Folder)) {
            $folderLabelId = $LabelIds[$definition.Folder]
        }
        $resource = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/resources" -Headers $csrfHeaders -Body @{
            resourceType = $definition.Type
            name = $definition.Name
            body = $definition.Body
            folderLabelId = $folderLabelId
        }
        $resourcesByName[$resource.name] = $resource
    }

    $spacePreviewName = "cytask-nebula-logo.png"
    if (!$resourcesByName.ContainsKey($spacePreviewName)) {
        $previewPath = Join-Path (Split-Path $PSScriptRoot -Parent) "assets/branding/cytask-logo.png"
        $previewBytes = [IO.File]::ReadAllBytes($previewPath)
        $previewHash = [Convert]::ToHexString(
            [Security.Cryptography.SHA256]::HashData($previewBytes)).ToLowerInvariant()
        $previewFolderId = if ($LabelIds.ContainsKey("Art")) { $LabelIds["Art"] } else { $null }
        $previewUpload = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/resource-uploads" -Headers $csrfHeaders -Body @{
            fileName = $spacePreviewName
            contentType = "image/png"
            sizeBytes = $previewBytes.Length
            sha256 = $previewHash
            folderLabelId = $previewFolderId
        }
        $previewChunkRequest = @{
            Uri = "$ApiBaseUrl/api/v1/resource-uploads/$($previewUpload.id)/chunks/0"
            Method = "Put"
            ContentType = "application/octet-stream"
            Body = $previewBytes
            Headers = @{
                "X-CSRF-Token" = $authentication.csrfToken
                "X-Chunk-SHA256" = $previewHash
            }
            WebSession = $ownerSession
        }
        Invoke-RestMethod @previewChunkRequest | Out-Null
        $spacePreview = Invoke-DemoApi -Method Post -Path "/api/v1/resource-uploads/$($previewUpload.id)/complete" -Headers $csrfHeaders
        $resourcesByName[$spacePreview.name] = $spacePreview
    }

    $channelDefinitions = @(
        @{ Name = "général"; Topic = "Coordination quotidienne de l’équipe"; ChannelType = "channel"; MemberIds = @() },
        @{ Name = "art-et-design"; Topic = "Références, captures et validations artistiques"; ChannelType = "channel"; MemberIds = @() },
        @{ Name = "build-et-qa"; Topic = "Builds, tests, blocages et comptes rendus"; ChannelType = "channel"; MemberIds = @() },
        @{ Name = "revue-hebdo"; Topic = "Préparation et suivi de la revue du vendredi"; ChannelType = "channel"; MemberIds = @() },
        @{
            Name = "direction-production"; Topic = "Décisions confidentielles de production"
            ChannelType = "group"
            MemberIds = @($memberIds["alice@cytask.local"], $memberIds["chloe@cytask.local"])
        }
    )
    $channelResponse = Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($Project.id)/chat/channels"
    $channels = @($channelResponse)
    $channelsByName = @{}
    foreach ($channel in $channels) {
        if ($null -eq $channel -or [string]::IsNullOrWhiteSpace([string]$channel.name)) { continue }
        $channelsByName[$channel.name] = $channel
    }
    foreach ($definition in $channelDefinitions) {
        if ($channelsByName.ContainsKey($definition.Name)) {
            continue
        }
        $channel = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/chat/channels" -Headers $csrfHeaders -Body $definition
        $channelsByName[$channel.name] = $channel
    }

    $general = $channelsByName["général"]
    $messageResponse = Invoke-DemoApi -Method Get -Path "/api/v1/chat/channels/$($general.id)/messages?limit=10"
    $existingMessages = @($messageResponse)
    if ($existingMessages.Count -eq 0) {
        $brief = $resourcesByName["Brief — Vertical Slice"]
        $moodboard = $resourcesByName["Moodboard du hangar"]
        $spacePreview = $resourcesByName[$spacePreviewName]
        $demoMessages = @(
            @{
                body = "Bienvenue dans l’espace Nebula. Le brief du projet est joint à ce salon."
                resourceIds = @($brief.id, $spacePreview.id); mentionedUserIds = @()
            },
            @{
                body = "@Alice Moreau peux-tu valider les références du moodboard avant la revue ?"
                resourceIds = @($moodboard.id); mentionedUserIds = @($memberIds["alice@cytask.local"])
            },
            @{
                body = "@Noah Bernard la build de ce soir doit inclure la dernière passe de collisions."
                resourceIds = @(); mentionedUserIds = @($memberIds["noah@cytask.local"])
            },
            @{
                body = "Le salon vocal est prêt pour le point d’équipe. Le partage d’écran utilise une connexion directe sécurisée."
                resourceIds = @(); mentionedUserIds = @()
            }
        )
        foreach ($message in $demoMessages) {
            Invoke-DemoApi -Method Post -Path "/api/v1/chat/channels/$($general.id)/messages" -Headers $csrfHeaders -Body $message | Out-Null
        }
    }
    else {
        $spacePreview = $resourcesByName[$spacePreviewName]
        $hasPreviewMessage = $existingMessages | Where-Object {
            $_.resources.id -contains $spacePreview.id
        }
        if (!$hasPreviewMessage) {
            Invoke-DemoApi -Method Post -Path "/api/v1/chat/channels/$($general.id)/messages" -Headers $csrfHeaders -Body @{
                body = "Le logo de l’espace est maintenant disponible dans la bibliothèque partagée."
                resourceIds = @($spacePreview.id); mentionedUserIds = @()
            } | Out-Null
        }
    }

    $productionGroup = $channelsByName["direction-production"]
    $groupMessageResponse = Invoke-DemoApi -Method Get -Path "/api/v1/chat/channels/$($productionGroup.id)/messages?limit=10"
    if (@($groupMessageResponse).Count -eq 0) {
        $taskOptions = Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($Project.id)/task-options"
        $linkedTask = @($taskOptions)[0]
        if ($null -ne $linkedTask) {
            $taskUrl = "$WebBaseUrl/#/tasks/$($linkedTask.id)"
            Invoke-DemoApi -Method Post -Path "/api/v1/chat/channels/$($productionGroup.id)/messages" -Headers $csrfHeaders -Body @{
                body = "Décision à suivre dans $($linkedTask.key) · $taskUrl"
                resourceIds = @()
                mentionedUserIds = @($memberIds["alice@cytask.local"])
            } | Out-Null
        }
    }
}

$projects = Invoke-DemoApi -Method Get -Path "/api/v1/projects"
$project = $projects | Where-Object { $_.key -eq "NEB" } | Select-Object -First 1
if ($null -ne $project) {
    $existingTaskPage = Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($project.id)/task-page?query=&status=all&priority=all&assignee=all&due=all&label=all&sort=updated&limit=1&utcOffsetMinutes=0"
    $existingTaskCount = [int]$existingTaskPage.totalCount
    $labelOverview = Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($project.id)/labels"
    $labelIdsByName = @{}
    foreach ($label in $labelOverview.labels) {
        $labelIdsByName[$label.name] = $label.id
    }
    Add-DemoSubfolders -Project $project -LabelIds $labelIdsByName
    $addedTaskCount = Add-PerformanceTasks -Project $project -ExistingCount $existingTaskCount -LabelIds $labelIdsByName
    $finalTaskCount = $existingTaskCount + $addedTaskCount
    $workflowStatuses = Set-DemoWorkflowExamples -Project $project
    $previewTaskPage = Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($project.id)/task-page?query=&status=all&priority=all&assignee=all&due=all&label=all&sort=key&limit=1&utcOffsetMinutes=0"
    if ($previewTaskPage.items.Count -gt 0) {
        Add-DemoMediaPreview -TaskId $previewTaskPage.items[0].id
    }
    Add-DemoCollaborationContent -Project $project -LabelIds $labelIdsByName

    Write-Host "Le projet de démonstration NEB a été vérifié : $finalTaskCount tâches disponibles."
    Write-Host "Connexion : $OwnerEmail / $Password"
    Write-Host "Ouvrez http://127.0.0.1:5173"
    exit 0
}

$project = Invoke-DemoApi -Method Post -Path "/api/v1/projects" -Headers $csrfHeaders -Body @{
    name = "Nebula Station — Vertical Slice"
    key = "NEB"
}

$now = [DateTimeOffset]::UtcNow
$taskDefinitions = @(
    @{
        Ref = "art-direction"; Title = "Valider la direction artistique"; Status = "done"; Priority = "high"; DueDays = -8
        Assignee = "alice@cytask.local"; Description = "Verrouiller la palette, les matériaux et les références visuelles du hangar orbital."
    },
    @{
        Ref = "hangar-blockout"; Title = "Finaliser le blockout du hangar"; Status = "in_progress"; Priority = "urgent"; DueDays = 2
        Assignee = "noah@cytask.local"; Description = "Ajuster les volumes, les circulations joueur et les zones réservées aux plans cinématiques."
    },
    @{
        Ref = "modular-kit"; Title = "Produire le kit modulaire sci-fi"; Status = "todo"; Priority = "high"; DueDays = 5
        Assignee = "alice@cytask.local"; Description = "Créer murs, portes, passerelles et variantes endommagées avec UV et collisions propres."
    },
    @{
        Ref = "lighting"; Title = "Première passe d’éclairage Lumen"; Status = "blocked"; Priority = "high"; DueDays = 6
        Assignee = "chloe@cytask.local"; Description = "Installer l’ambiance principale et les repères lumineux de navigation du niveau."
    },
    @{
        Ref = "terminal-gameplay"; Title = "Interaction du terminal de maintenance"; Status = "in_progress"; Priority = "normal"; DueDays = 4
        Assignee = $OwnerEmail; Description = "Brancher l’interaction, l’interface diégétique et les retours audio du terminal."
    },
    @{
        Ref = "ambiences"; Title = "Intégrer les ambiances sonores"; Status = "todo"; Priority = "normal"; DueDays = 9
        Assignee = "chloe@cytask.local"; Description = "Créer les boucles de ventilation, alarmes lointaines et variations par zone."
    },
    @{
        Ref = "shader-optimization"; Title = "Optimiser les shaders du hangar"; Status = "blocked"; Priority = "urgent"; DueDays = -1
        Assignee = "noah@cytask.local"; Description = "Réduire les permutations et revenir sous le budget GPU cible de la vertical slice."
    },
    @{
        Ref = "trailer-capture"; Title = "Capturer le trailer interne"; Status = "todo"; Priority = "high"; DueDays = 12
        Assignee = $OwnerEmail; Description = "Préparer cinq plans Sequencer et exporter une version de revue en 1440p."
    },
    @{
        Ref = "collision-qa"; Title = "QA collisions et navigation"; Status = "done"; Priority = "normal"; DueDays = -3
        Assignee = "noah@cytask.local"; Description = "Vérifier les collisions complexes, les pentes et les points de blocage du navmesh."
    },
    @{
        Ref = "review-build"; Title = "Préparer la build de revue"; Status = "todo"; Priority = "normal"; DueDays = $null
        Assignee = $null; Description = "Assembler une build Windows reproductible avec logs et paramètres de diagnostic."
    },
    @{
        Ref = "documentation"; Title = "Documenter le pipeline d’intégration"; Status = "in_progress"; Priority = "low"; DueDays = 7
        Assignee = "alice@cytask.local"; Description = "Décrire les conventions de nommage, dossiers et validation des assets entrants."
    },
    @{
        Ref = "milestone"; Title = "Clôturer le jalon Vertical Slice"; Status = "todo"; Priority = "urgent"; DueDays = 14
        Assignee = $OwnerEmail; Description = "Consolider les retours, la build, la vidéo et la décision de passage au jalon suivant."
    },
    @{
        Ref = "niagara-research"; Title = "R&D fumée Niagara volumétrique"; Status = "cancelled"; Priority = "low"; DueDays = $null
        Assignee = "chloe@cytask.local"; Description = "Piste abandonnée pour la vertical slice afin de préserver le budget GPU."
    }
)

$createdTasks = @{}
foreach ($definition in $taskDefinitions) {
    $dueAt = $null
    if ($null -ne $definition.DueDays) {
        $dueAt = $now.AddDays([double]$definition.DueDays).ToString("o")
    }
    $assigneeId = $null
    if ($null -ne $definition.Assignee) {
        $assigneeId = $memberIds[$definition.Assignee]
    }

    $created = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($project.id)/tasks" -Headers $csrfHeaders -Body @{
        title = $definition.Title
        description = $definition.Description
        priority = $definition.Priority
        dueAt = $dueAt
        assigneeId = $assigneeId
    }

    if ($definition.Status -ne "todo") {
        $created = Invoke-DemoApi -Method Patch -Path "/api/v1/tasks/$($created.id)" -Headers $csrfHeaders -Body @{
            title = $created.title
            description = $created.description
            status = $definition.Status
            priority = $created.priority
            dueAt = $created.dueAt
            assigneeId = $created.assigneeId
            expectedRevision = $created.revision
        }
    }
    $createdTasks[$definition.Ref] = $created
}
$labelDefinitions = @(
    @{ Ref = "art"; Name = "Art"; Color = "#A855F7"; Tasks = @("art-direction", "modular-kit", "lighting", "shader-optimization") },
    @{ Ref = "gameplay"; Name = "Gameplay"; Color = "#3B82F6"; Tasks = @("hangar-blockout", "terminal-gameplay", "collision-qa") },
    @{ Ref = "audio"; Name = "Audio"; Color = "#F59E0B"; Tasks = @("terminal-gameplay", "ambiences") },
    @{ Ref = "build"; Name = "Build"; Color = "#22C55E"; Tasks = @("review-build", "documentation", "milestone") },
    @{ Ref = "urgent"; Name = "Urgent"; Color = "#EF4444"; Tasks = @("hangar-blockout", "shader-optimization", "milestone") },
    @{ Ref = "research"; Name = "R&D"; Color = "#06B6D4"; Tasks = @("niagara-research") }
)

$createdLabels = @{}
$labelAssignmentCount = 0
foreach ($definition in $labelDefinitions) {
    $label = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($project.id)/labels" -Headers $csrfHeaders -Body @{
        name = $definition.Name
        color = $definition.Color
    }
    $createdLabels[$definition.Ref] = $label
    foreach ($taskRef in $definition.Tasks) {
        $taskId = $createdTasks[$taskRef].id
        Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$taskId/labels/$($label.id)" -Headers $csrfHeaders | Out-Null
        $labelAssignmentCount += 1
    }
}



$labelIdsByName = @{}
foreach ($label in $createdLabels.Values) {
    $labelIdsByName[$label.name] = $label.id
}
Add-DemoSubfolders -Project $project -LabelIds $labelIdsByName
$performanceTaskCount = Add-PerformanceTasks -Project $project -ExistingCount $createdTasks.Count -LabelIds $labelIdsByName
$workflowStatuses = Set-DemoWorkflowExamples -Project $project

$hierarchyDefinitions = @(
    @("hangar-blockout", "milestone"),
    @("terminal-gameplay", "milestone"),
    @("trailer-capture", "milestone"),
    @("review-build", "milestone"),
    @("documentation", "milestone"),
    @("modular-kit", "hangar-blockout"),
    @("lighting", "hangar-blockout"),
    @("collision-qa", "hangar-blockout"),
    @("shader-optimization", "hangar-blockout"),
    @("ambiences", "terminal-gameplay")
)

foreach ($relation in $hierarchyDefinitions) {
    $taskId = $createdTasks[$relation[0]].id
    $parentTaskId = $createdTasks[$relation[1]].id
    Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$taskId/parent/$parentTaskId" -Headers $csrfHeaders | Out-Null
}

$dependencyDefinitions = @(
    @("modular-kit", "hangar-blockout"),
    @("lighting", "modular-kit"),
    @("trailer-capture", "lighting"),
    @("trailer-capture", "ambiences"),
    @("review-build", "collision-qa"),
    @("review-build", "terminal-gameplay"),
    @("milestone", "shader-optimization"),
    @("milestone", "trailer-capture"),
    @("milestone", "documentation")
)

foreach ($dependency in $dependencyDefinitions) {
    $taskId = $createdTasks[$dependency[0]].id
    $dependsOnTaskId = $createdTasks[$dependency[1]].id
    Invoke-DemoApi -Method Post -Path "/api/v1/tasks/$taskId/dependencies" -Headers $csrfHeaders -Body @{
        dependsOnTaskId = $dependsOnTaskId
    } | Out-Null
}

$checklistDefinitions = @(
    @{
        Task = "hangar-blockout"
        Items = @(
            @{ Title = "Tester les circulations joueur"; Completed = $true },
            @{ Title = "Valider les axes caméra"; Completed = $true },
            @{ Title = "Nettoyer les volumes temporaires"; Completed = $false }
        )
    },
    @{
        Task = "trailer-capture"
        Items = @(
            @{ Title = "Verrouiller les cinq plans Sequencer"; Completed = $false },
            @{ Title = "Vérifier les sous-titres de revue"; Completed = $false },
            @{ Title = "Exporter la version 1440p"; Completed = $false }
        )
    },
    @{
        Task = "review-build"
        Items = @(
            @{ Title = "Compiler la configuration Shipping"; Completed = $true },
            @{ Title = "Joindre les symboles et les logs"; Completed = $false },
            @{ Title = "Tester sur une machine propre"; Completed = $false }
        )
    }
)

foreach ($checklist in $checklistDefinitions) {
    $taskId = $createdTasks[$checklist.Task].id
    foreach ($definition in $checklist.Items) {
        $item = Invoke-DemoApi -Method Post -Path "/api/v1/tasks/$taskId/checklist" -Headers $csrfHeaders -Body @{
            title = $definition.Title
        }
        if ($definition.Completed) {
            Invoke-DemoApi -Method Patch -Path "/api/v1/tasks/$taskId/checklist/$($item.id)" -Headers $csrfHeaders -Body @{
                title = $item.title
                isCompleted = $true
                expectedRevision = $item.revision
            } | Out-Null
        }
    }
}


$comments = @(
    @{ Task = "hangar-blockout"; Body = "Le passage côté baie vitrée est maintenant assez large pour la caméra et le gameplay." },
    @{ Task = "shader-optimization"; Body = "Le profil GPU montre encore deux matériaux maîtres trop coûteux sur les plateformes." },
    @{ Task = "milestone"; Body = "Le jalon restera ouvert tant que la build et le trailer n’auront pas été validés." },
    @{ Task = "art-direction"; Body = "Palette approuvée pendant la revue artistique de lundi." }
)
foreach ($comment in $comments) {
    $taskId = $createdTasks[$comment.Task].id
    Invoke-DemoApi -Method Post -Path "/api/v1/tasks/$taskId/comments" -Headers $csrfHeaders -Body @{
        body = $comment.Body
    } | Out-Null
}

$references = @(
    @{ Task = "terminal-gameplay"; Value = "feature/maintenance-terminal"; Type = "branch"; Label = "Branche gameplay terminal" },
    @{ Task = "shader-optimization"; Value = "7a31d9f"; Type = "commit"; Label = "Réduction des permutations shader" },
    @{ Task = "review-build"; Value = "release/vertical-slice-review"; Type = "branch"; Label = "Branche de build de revue" }
)
foreach ($reference in $references) {
    $taskId = $createdTasks[$reference.Task].id
    Invoke-DemoApi -Method Post -Path "/api/v1/tasks/$taskId/external-references" -Headers $csrfHeaders -Body @{
        provider = "git"
        repository = "northstar/nebula-station"
        referenceType = $reference.Type
        referenceValue = $reference.Value
        label = $reference.Label
        webUrl = $null
    } | Out-Null
}

foreach ($pluginId in @("dev.cytask.git", "dev.cytask.ai-assistant", "dev.cytask.unreal", "dev.cytask.cyrevision", "dev.cytask.cyannota")) {
    Invoke-DemoApi -Method Put -Path "/api/v1/projects/$($project.id)/plugins/$pluginId" -Headers $csrfHeaders | Out-Null
}

$gitPlugin = Invoke-DemoApi -Method Get -Path "/api/v1/tasks/$($createdTasks["terminal-gameplay"].id)/plugins/dev.cytask.git/data"
Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$($createdTasks["terminal-gameplay"].id)/plugins/dev.cytask.git/data" -Headers $csrfHeaders -Body @{
    expectedRevision = $gitPlugin.revision
    data = @{
        provider = "GitHub"
        repository = "northstar/nebula-station"
        defaultBranch = "main"
        remoteUrl = "https://github.com/northstar/nebula-station.git"
        integrationMode = "Références manuelles"
        autoLink = $true
    }
} | Out-Null

$aiConnections = @(Invoke-DemoApi -Method Get -Path "/api/v1/projects/$($project.id)/plugins/ai-assistant/connections")
$demoAiConnection = $aiConnections | Where-Object { $_.name -eq "Ollama local · démonstration" } | Select-Object -First 1
if ($null -eq $demoAiConnection) {
    $demoAiConnection = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($project.id)/plugins/ai-assistant/connections" -Headers $csrfHeaders -Body @{
        name = "Ollama local · démonstration"
        provider = "ollama"
        model = "qwen3-coder"
        baseUrl = "http://127.0.0.1:11434"
        secret = $null
    }
}

$aiPlugin = Invoke-DemoApi -Method Get -Path "/api/v1/tasks/$($createdTasks["documentation"].id)/plugins/dev.cytask.ai-assistant/data"
Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$($createdTasks["documentation"].id)/plugins/dev.cytask.ai-assistant/data" -Headers $csrfHeaders -Body @{
    expectedRevision = $aiPlugin.revision
    data = @{
        connectionId = [string]$demoAiConnection.id
        goal = "Préparer une checklist de documentation technique à partir du ticket."
        includeComments = $true
        outputMode = "Checklist"
        instructions = "Ne jamais inventer de chemin d’asset et signaler les informations manquantes."
        lastSummary = "Démonstration : profil Ollama prêt. L’exécution locale reste désactivée tant que l’administrateur ne l’autorise pas."
    }
} | Out-Null

$unrealPlugin = Invoke-DemoApi -Method Get -Path "/api/v1/tasks/$($createdTasks["hangar-blockout"].id)/plugins/dev.cytask.unreal/data"
Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$($createdTasks["hangar-blockout"].id)/plugins/dev.cytask.unreal/data" -Headers $csrfHeaders -Body @{
    expectedRevision = $unrealPlugin.revision
    data = @{
        engineVersion = "5.8"
        projectName = "NebulaStation"
        mapPath = "/Game/Maps/VerticalSlice/Hangar"
        assetPaths = @("/Game/Environment/Hangar", "/Game/Gameplay/Interaction")
        targetPlatform = "Win64"
        reviewBuild = "VerticalSlice-Review-12"
        notes = "Contexte capturé depuis le projet Unreal fictif de la démonstration."
    }
} | Out-Null

$cyRevisionPlugin = Invoke-DemoApi -Method Get -Path "/api/v1/tasks/$($createdTasks["shader-optimization"].id)/plugins/dev.cytask.cyrevision/data"
Invoke-DemoApi -Method Put -Path "/api/v1/tasks/$($createdTasks["shader-optimization"].id)/plugins/dev.cytask.cyrevision/data" -Headers $csrfHeaders -Body @{
    expectedRevision = $cyRevisionPlugin.revision
    data = @{
        repository = "northstar/nebula-station"
        branch = "feature/NEB-shader-budget"
        revisionId = "rev-nebula-0012"
        commitSha = "7a31d9f"
        revisionUrl = "cyrevision://revision/rev-nebula-0012"
        changedFiles = @("Content/Materials/M_Hangar_Master.uasset", "Config/DefaultEngine.ini")
        syncMode = "Git LFS"
        summary = "Réduction des permutations shader et mise à jour du profil de build."
    }
} | Out-Null

Add-DemoMediaPreview -TaskId $createdTasks["art-direction"].id
Add-DemoCollaborationContent -Project $project -LabelIds $labelIdsByName
Write-Host "Projet de démonstration créé : $($project.name)"
Write-Host "220 tâches, 7 états dont 2 personnalisés, 5 plugins officiels, responsables multiples, 10 dossiers, 6 contenus d’espace, 4 salons, 1 groupe privé, 4 membres, 9 dépendances et 3 références Git."
Write-Host "Connexion : $OwnerEmail / $Password"
Write-Host "Ouvrez http://127.0.0.1:5173"
