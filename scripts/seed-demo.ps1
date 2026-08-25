#requires -Version 7.0

param(
    [string]$ApiBaseUrl = "http://127.0.0.1:5080",
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
        @{ Prefix = "[ART]"; Label = "Art"; Titles = @("Kit modulaire de maintenance", "Passe matériaux du hangar", "Déclinaison des props de coursive", "Optimisation des LOD de décor") },
        @{ Prefix = "[GAMEPLAY]"; Label = "Gameplay"; Titles = @("Interaction du sas secondaire", "Réglage de la gravité locale", "Feedback du terminal de contrôle", "Parcours joueur de la baie orbitale") },
        @{ Prefix = "[AUDIO]"; Label = "Audio"; Titles = @("Ambiance de ventilation", "Variation de l’alarme de secteur", "Mix du terminal diégétique", "Occlusion des coursives techniques") },
        @{ Prefix = "[BUILD]"; Label = "Build"; Titles = @("Validation de la build Windows", "Analyse du rapport de crash", "Préparation du paquet de revue", "Contrôle des symboles de diagnostic") },
        @{ Prefix = "[QA]"; Label = "Gameplay"; Titles = @("Vérification des collisions", "Test de régression multijoueur", "Contrôle du navmesh du hangar", "Reproduction du défaut d’interaction") },
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
        $assigneeId = if ($index % 13 -eq 0 -or $assigneePool.Count -eq 0) {
            $null
        }
        else {
            $assigneePool[($index - 1) % $assigneePool.Count]
        }

        $createdTask = Invoke-DemoApi -Method Post -Path "/api/v1/projects/$($Project.id)/tasks" -Headers $csrfHeaders -Body @{
            title = "$($catalog.Prefix) $titleVariant · lot $sequence"
            description = "Tâche de démonstration $sequence pour tester la navigation, les filtres, la pagination et la charge d’un projet de production réaliste."
            priority = $priority
            dueAt = $dueAt
            assigneeId = $assigneeId
        }

        if ($status -ne "todo") {
            $createdTask = Invoke-DemoApi -Method Patch -Path "/api/v1/tasks/$($createdTask.id)" -Headers $csrfHeaders -Body @{
                title = $createdTask.title
                description = $createdTask.description
                status = $status
                priority = $createdTask.priority
                dueAt = $createdTask.dueAt
                assigneeId = $createdTask.assigneeId
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
    $addedTaskCount = Add-PerformanceTasks -Project $project -ExistingCount $existingTaskCount -LabelIds $labelIdsByName
    $finalTaskCount = $existingTaskCount + $addedTaskCount

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
$performanceTaskCount = Add-PerformanceTasks -Project $project -ExistingCount $createdTasks.Count -LabelIds $labelIdsByName

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

Write-Host "Projet de démonstration créé : $($project.name)"
Write-Host "220 tâches de charge, 10 relations parentales, 9 éléments de checklist, 6 dossiers par labels, 4 membres, 9 dépendances, 4 commentaires et 3 références Git."
Write-Host "Connexion : $OwnerEmail / $Password"
Write-Host "Ouvrez http://127.0.0.1:5173"
