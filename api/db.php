<?php
// =========================================================================
// CONEXIÓN A BASE DE DATOS MYSQL (XAMPP) Y AUTO-INICIALIZACIÓN
// =========================================================================

$db_host = 'localhost';
$db_user = 'root';
$db_pass = '';
$db_name = 'huellitas_db';

try {
    // 1. Conexión al servidor MySQL para garantizar que la base de datos exista
    $pdo_init = new PDO("mysql:host={$db_host};charset=utf8mb4", $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
    ]);
    $pdo_init->exec("CREATE DATABASE IF NOT EXISTS `{$db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    // 2. Conexión a la base de datos del proyecto
    $pdo = new PDO("mysql:host={$db_host};dbname={$db_name};charset=utf8mb4", $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
    ]);

    // 3. Crear tabla de usuarios si no existe
    $pdo->exec("CREATE TABLE IF NOT EXISTS `usuarios` (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `nombre` VARCHAR(100) NOT NULL,
        `identificador` VARCHAR(120) NOT NULL UNIQUE,
        `tipo_identificador` ENUM('correo', 'telefono') NOT NULL,
        `password_hash` VARCHAR(255) NOT NULL,
        `rol` ENUM('admin', 'cliente') DEFAULT 'cliente',
        `fecha_registro` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        `estado` ENUM('activo', 'inactivo') DEFAULT 'activo'
    ) ENGINE=InnoDB;");

    // 4. Crear usuario Administrador inicial por defecto si no existe
    $stmt = $pdo->prepare("SELECT id FROM usuarios WHERE identificador = ?");
    $stmt->execute(['admin@huellitas.com']);
    if (!$stmt->fetch()) {
        $admin_hash = password_hash('admin123', PASSWORD_BCRYPT);
        $ins = $pdo->prepare("INSERT INTO usuarios (nombre, identificador, tipo_identificador, password_hash, rol) VALUES (?, ?, ?, ?, ?)");
        $ins->execute(['Administrador Huellitas', 'admin@huellitas.com', 'correo', $admin_hash, 'admin']);
    }

} catch (PDOException $e) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Error al conectar con la base de datos MySQL de XAMPP: ' . $e->getMessage()
    ]);
    exit;
}
