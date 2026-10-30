<?php
// =========================================================================
// API DE AUTENTICACIÓN Y REGISTRO (CORREO O TELÉFONO) - HUELLITAS
// =========================================================================

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

require_once __DIR__ . '/db.php';

// Leer datos enviados (POST en JSON o Form-Data)
$input_data = [];
$raw_json = file_get_contents('php://input');
if (!empty($raw_json)) {
    $decoded = json_decode($raw_json, true);
    if (is_array($decoded)) {
        $input_data = $decoded;
    }
}
$data = array_merge($_REQUEST, $input_data);
$action = $data['action'] ?? '';

switch ($action) {

    // ---------------------------------------------------------------------
    // 1. REGISTRO DE NUEVO USUARIO (CORREO O TELÉFONO)
    // ---------------------------------------------------------------------
    case 'register':
        $nombre = trim($data['nombre'] ?? '');
        $identificador_raw = trim($data['identificador'] ?? '');
        $password = (string)($data['password'] ?? '');
        $confirm_password = (string)($data['confirm_password'] ?? '');

        if (empty($nombre)) {
            echo json_encode(['success' => false, 'error' => 'Por favor ingresa tu nombre completo.']);
            exit;
        }

        if (empty($identificador_raw)) {
            echo json_encode(['success' => false, 'error' => 'Ingresa un correo electrónico o tu número de teléfono.']);
            exit;
        }

        // Determinar si es correo o teléfono
        $tipo_identificador = null;
        $identificador = $identificador_raw;

        if (filter_var($identificador_raw, FILTER_VALIDATE_EMAIL)) {
            $tipo_identificador = 'correo';
            $identificador = strtolower($identificador_raw);
        } else {
            // Verificar si es número telefónico (7 a 15 dígitos)
            $phone_digits = preg_replace('/[^0-9]/', '', $identificador_raw);
            if (strlen($phone_digits) >= 7 && strlen($phone_digits) <= 15) {
                $tipo_identificador = 'telefono';
                $identificador = $phone_digits;
            }
        }

        if (!$tipo_identificador) {
            echo json_encode([
                'success' => false,
                'error' => 'El dato ingresado no parece ser un correo válido ni un número de teléfono válido (mínimo 7 dígitos).'
            ]);
            exit;
        }

        if (strlen($password) < 6) {
            echo json_encode(['success' => false, 'error' => 'La contraseña debe tener al menos 6 caracteres.']);
            exit;
        }

        if ($password !== $confirm_password) {
            echo json_encode(['success' => false, 'error' => 'Las contraseñas no coinciden.']);
            exit;
        }

        // Verificar si ya está registrado
        $chk = $pdo->prepare("SELECT id FROM usuarios WHERE identificador = ?");
        $chk->execute([$identificador]);
        if ($chk->fetch()) {
            echo json_encode(['success' => false, 'error' => 'Este correo o número de teléfono ya se encuentra registrado. Inicia sesión.']);
            exit;
        }

        // Crear usuario
        $password_hash = password_hash($password, PASSWORD_BCRYPT);
        $rol = 'cliente';

        $ins = $pdo->prepare("INSERT INTO usuarios (nombre, identificador, tipo_identificador, password_hash, rol) VALUES (?, ?, ?, ?, ?)");
        $ins->execute([$nombre, $identificador, $tipo_identificador, $password_hash, $rol]);
        $new_id = (int)$pdo->lastInsertId();

        // Autenticar automáticamente
        $_SESSION['user_id'] = $new_id;
        $_SESSION['nombre'] = $nombre;
        $_SESSION['identificador'] = $identificador;
        $_SESSION['rol'] = $rol;

        echo json_encode([
            'success' => true,
            'message' => '¡Cuenta creada con éxito! Bienvenido a la familia Huellitas.',
            'user' => [
                'id' => $new_id,
                'nombre' => $nombre,
                'identificador' => $identificador,
                'tipo' => $tipo_identificador,
                'rol' => $rol
            ]
        ]);
        break;

    // ---------------------------------------------------------------------
    // 2. INICIO DE SESIÓN
    // ---------------------------------------------------------------------
    case 'login':
        $identificador_raw = trim($data['identificador'] ?? '');
        $password = (string)($data['password'] ?? '');

        if (empty($identificador_raw) || empty($password)) {
            echo json_encode(['success' => false, 'error' => 'Por favor ingresa tu correo o teléfono y tu contraseña.']);
            exit;
        }

        // Normalizar identificador
        $identificador = $identificador_raw;
        if (filter_var($identificador_raw, FILTER_VALIDATE_EMAIL)) {
            $identificador = strtolower($identificador_raw);
        } else {
            $phone_digits = preg_replace('/[^0-9]/', '', $identificador_raw);
            if (!empty($phone_digits)) {
                $identificador = $phone_digits;
            }
        }

        $stmt = $pdo->prepare("SELECT id, nombre, identificador, tipo_identificador, password_hash, rol, estado FROM usuarios WHERE identificador = ? OR identificador = ? LIMIT 1");
        $stmt->execute([$identificador, $identificador_raw]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            echo json_encode(['success' => false, 'error' => 'Correo/teléfono o contraseña incorrectos.']);
            exit;
        }

        if ($user['estado'] !== 'activo') {
            echo json_encode(['success' => false, 'error' => 'Tu cuenta se encuentra inactiva. Contacta soporte.']);
            exit;
        }

        // Guardar sesión
        $_SESSION['user_id'] = (int)$user['id'];
        $_SESSION['nombre'] = $user['nombre'];
        $_SESSION['identificador'] = $user['identificador'];
        $_SESSION['rol'] = $user['rol'];

        echo json_encode([
            'success' => true,
            'message' => '¡Hola de nuevo, ' . htmlspecialchars($user['nombre']) . '!',
            'user' => [
                'id' => (int)$user['id'],
                'nombre' => $user['nombre'],
                'identificador' => $user['identificador'],
                'tipo' => $user['tipo_identificador'],
                'rol' => $user['rol']
            ]
        ]);
        break;

    // ---------------------------------------------------------------------
    // 3. CONSULTAR SESIÓN ACTIVA
    // ---------------------------------------------------------------------
    case 'check_session':
        if (!empty($_SESSION['user_id'])) {
            // Verificar si el usuario aún existe y su rol actualizado
            $q = $pdo->prepare("SELECT id, nombre, identificador, tipo_identificador, rol FROM usuarios WHERE id = ?");
            $q->execute([$_SESSION['user_id']]);
            $current = $q->fetch();

            if ($current) {
                echo json_encode([
                    'success' => true,
                    'authenticated' => true,
                    'user' => [
                        'id' => (int)$current['id'],
                        'nombre' => $current['nombre'],
                        'identificador' => $current['identificador'],
                        'tipo' => $current['tipo_identificador'],
                        'rol' => $current['rol']
                    ]
                ]);
                exit;
            }
        }

        echo json_encode([
            'success' => true,
            'authenticated' => false
        ]);
        break;

    // ---------------------------------------------------------------------
    // 4. CERRAR SESIÓN
    // ---------------------------------------------------------------------
    case 'logout':
        $_SESSION = [];
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params["path"], $params["domain"],
                $params["secure"], $params["httponly"]
            );
        }
        session_destroy();
        echo json_encode(['success' => true, 'message' => 'Sesión cerrada correctamente.']);
        break;

    // ---------------------------------------------------------------------
    // 5. PANEL ADMINISTRADOR: LISTAR USUARIOS REGISTRADOS
    // ---------------------------------------------------------------------
    case 'list_users':
        if (empty($_SESSION['rol']) || $_SESSION['rol'] !== 'admin') {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Acceso denegado. Se requieren privilegios de administrador.']);
            exit;
        }

        $all = $pdo->query("SELECT id, nombre, identificador, tipo_identificador, rol, fecha_registro, estado FROM usuarios ORDER BY id DESC")->fetchAll();
        $totalClientes = 0;
        $totalAdmins = 0;
        foreach ($all as $u) {
            if ($u['rol'] === 'admin') $totalAdmins++;
            else $totalClientes++;
        }

        echo json_encode([
            'success' => true,
            'users' => $all,
            'stats' => [
                'total' => count($all),
                'clientes' => $totalClientes,
                'admins' => $totalAdmins
            ]
        ]);
        break;

    default:
        echo json_encode(['success' => false, 'error' => 'Acción no válida.']);
        break;
}
