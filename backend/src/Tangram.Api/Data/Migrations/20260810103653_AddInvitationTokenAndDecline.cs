using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInvitationTokenAndDecline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_invitations_email_accepted_at",
                table: "invitations");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "declined_at",
                table: "invitations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "expires_at",
                table: "invitations",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<string>(
                name: "token",
                table: "invitations",
                type: "text",
                nullable: false,
                defaultValue: "");

            // Existing rows predate the token, and the unique index below would
            // collide on the empty-string default the moment there is more than
            // one of them. Give each a distinct secret first.
            //
            // These tokens are newly minted and have never been sent anywhere,
            // so every pre-existing invitation becomes inert on its own: the
            // address no longer grants anything, and nobody holds the secret
            // that now does. An owner who still wants one to work copies the
            // fresh link from the members page. The expiry is just the ordinary
            // seven-day clock measured from when the invitation was created,
            // which puts the older ones past it already.
            migrationBuilder.Sql("""
                UPDATE invitations
                SET token = replace(gen_random_uuid()::text, '-', '')
                         || replace(gen_random_uuid()::text, '-', ''),
                    expires_at = created_at + interval '7 days'
                WHERE token = '';
                """);

            migrationBuilder.CreateIndex(
                name: "ix_invitations_token",
                table: "invitations",
                column: "token",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_invitations_token",
                table: "invitations");

            migrationBuilder.DropColumn(
                name: "declined_at",
                table: "invitations");

            migrationBuilder.DropColumn(
                name: "expires_at",
                table: "invitations");

            migrationBuilder.DropColumn(
                name: "token",
                table: "invitations");

            migrationBuilder.CreateIndex(
                name: "ix_invitations_email_accepted_at",
                table: "invitations",
                columns: new[] { "email", "accepted_at" });
        }
    }
}
